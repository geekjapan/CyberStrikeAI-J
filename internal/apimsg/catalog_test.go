package apimsg

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
	"unicode"

	"github.com/gin-gonic/gin"
)

// source is one message found in the Go code.
type source struct {
	Text     string `json:"text"`
	Response bool   `json:"response"` // sent to a client as it is: an "error"/"message" field, a stream event, a Translate call
	Where    string `json:"where"`
}

// ordered holds every extracted message in traversal order, duplicates
// included.  APIMSG_KEYS dumps it so a bulk rewrite of the source messages can
// re-key the catalog by position.
var ordered []source

func hasHan(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

// flatten turns "创建失败: " + err.Error() into the format "创建失败: %v".
// It returns "" when the expression holds no string literal.
func flatten(e ast.Expr) (string, bool) {
	switch v := e.(type) {
	case *ast.BasicLit:
		if v.Kind != token.STRING {
			return "", false
		}
		s, err := strconv.Unquote(v.Value)
		return strings.ReplaceAll(s, "%", "%%"), err == nil
	case *ast.ParenExpr:
		return flatten(v.X)
	case *ast.BinaryExpr:
		if v.Op != token.ADD {
			return "", false
		}
		l, lok := flatten(v.X)
		r, rok := flatten(v.Y)
		if !lok && !rok {
			return "", false
		}
		if !lok {
			l = "%v"
		}
		if !rok {
			r = "%v"
		}
		return l + r, true
	case *ast.CallExpr:
		if name := callName(v); (name == "fmt.Sprintf" || name == "fmt.Errorf" || name == "errors.New") && len(v.Args) > 0 {
			if lit, ok := v.Args[0].(*ast.BasicLit); ok && lit.Kind == token.STRING {
				s, err := strconv.Unquote(lit.Value)
				return s, err == nil
			}
		}
	}
	return "", false
}

func callName(c *ast.CallExpr) string {
	if sel, ok := c.Fun.(*ast.SelectorExpr); ok {
		if pkg, ok := sel.X.(*ast.Ident); ok {
			return pkg.Name + "." + sel.Sel.Name
		}
	}
	return ""
}

// extract lists the messages in the non-test Go files under root.
func extract(t *testing.T, root string) []source {
	t.Helper()
	seen := map[string]int{}
	var out []source
	add := func(text string, response bool, pos token.Position) {
		if strings.TrimSpace(text) == "" {
			return
		}
		{
			rel, _ := filepath.Rel(root, pos.Filename)
			ordered = append(ordered, source{Text: text, Response: response, Where: rel})
		}
		if i, ok := seen[text]; ok {
			out[i].Response = out[i].Response || response
			return
		}
		seen[text] = len(out)
		rel, _ := filepath.Rel(root, pos.Filename)
		out = append(out, source{Text: text, Response: response, Where: rel + ":" + strconv.Itoa(pos.Line)})
	}
	fset := token.NewFileSet()
	for _, dir := range []string{"internal", "cmd"} {
		err := filepath.WalkDir(filepath.Join(root, dir), func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return err
			}
			file, err := parser.ParseFile(fset, path, nil, 0)
			if err != nil {
				return err
			}
			ast.Inspect(file, func(n ast.Node) bool {
				switch v := n.(type) {
				case *ast.KeyValueExpr:
					if key, ok := v.Key.(*ast.BasicLit); ok && (key.Value == `"error"` || key.Value == `"message"`) {
						if text, ok := flatten(v.Value); ok {
							add(text, true, fset.Position(v.Pos()))
						}
					}
				case *ast.AssignStmt:
					// errMsg := "Execution failed: " + reason; sent to the client later.
					for i, lhs := range v.Lhs {
						if name, ok := lhs.(*ast.Ident); ok && i < len(v.Rhs) && messageVar.MatchString(name.Name) {
							if text, ok := flatten(v.Rhs[i]); ok {
								add(text, true, fset.Position(v.Pos()))
							}
						}
					}
				case *ast.CompositeLit:
					if typ, ok := v.Type.(*ast.Ident); ok && typ.Name == "StreamEvent" {
						for _, elt := range v.Elts {
							kv, ok := elt.(*ast.KeyValueExpr)
							if key, isIdent := kv.Key.(*ast.Ident); ok && isIdent && key.Name == "Message" {
								if text, ok := flatten(kv.Value); ok {
									add(text, true, fset.Position(kv.Pos()))
								}
							}
						}
					}
				case *ast.CallExpr:
					name := callName(v)
					if name == "errors.New" || name == "fmt.Errorf" {
						if text, ok := flatten(v); ok {
							add(text, false, fset.Position(v.Pos()))
						}
					}
					// apimsg.Translate(lang, msg) and stream events: send("error", msg, data).
					if len(v.Args) >= 2 && (name == "apimsg.Translate" || eventSender(v)) {
						if text, ok := flatten(v.Args[1]); ok {
							add(text, true, fset.Position(v.Pos()))
						}
					}
				}
				return true
			})
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Where < out[j].Where })
	return out
}

// messageVar matches local variables that hold a message for the client.
var messageVar = regexp.MustCompile(`(?i)(msg|message|notice)$`)

var eventName = regexp.MustCompile(`^"[a-z]+(_[a-z]+)*"$`)

// eventType reports whether e is a literal stream event type such as "error".
func eventType(e ast.Expr) bool {
	lit, ok := e.(*ast.BasicLit)
	return ok && lit.Kind == token.STRING && eventName.MatchString(lit.Value)
}

// eventSender reports whether c looks like send("error", message, data): a
// call of a local function value or method whose first argument is an event
// type.  Package-level calls such as flag.String are not event senders.
func eventSender(c *ast.CallExpr) bool {
	if !eventType(c.Args[0]) {
		return false
	}
	switch fn := c.Fun.(type) {
	case *ast.Ident:
		lower := strings.ToLower(fn.Name)
		return strings.Contains(lower, "event") || strings.Contains(lower, "progress") || strings.Contains(lower, "callback") || strings.Contains(lower, "emit")
	}
	return false
}

func verbs(s string) int {
	n := 0
	for _, v := range verb.FindAllString(s, -1) {
		if v != "%%" {
			n++
		}
	}
	return n
}

// Every message the server sends to a client as it is must have a Chinese and
// a Japanese translation.  To list what is missing (including error values
// from lower packages, which are not required), run:
//
//	APIMSG_DUMP=/tmp/missing.json go test ./internal/apimsg -run Covers
func TestCatalogCoversResponseMessages(t *testing.T) {
	var catalog map[string]entry
	if err := json.Unmarshal(catalogJSON, &catalog); err != nil {
		t.Fatal(err)
	}
	loadOnce.Do(load)
	var missing []source
	required := 0
	for _, s := range extract(t, filepath.Join("..", "..")) {
		if hasHan(s.Text) {
			// Source text that is still Chinese is reported by the repository-wide
			// language test, not here.
			continue
		}
		if covered(s.Text, "ja") {
			continue
		}
		missing = append(missing, s)
		if s.Response && translatable(s.Text) {
			required++
			if required <= 15 {
				t.Errorf("no ja translation in catalog.json for %q (%s)", s.Text, s.Where)
			}
		}
	}
	if path := os.Getenv("APIMSG_KEYS"); path != "" {
		raw, _ := json.Marshal(ordered)
		if err := os.WriteFile(path, raw, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if path := os.Getenv("APIMSG_DUMP"); path != "" {
		raw, _ := json.MarshalIndent(missing, "", " ")
		if err := os.WriteFile(path, raw, 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %d untranslated messages to %s", len(missing), path)
	}
	if required > 15 {
		t.Errorf("... and %d more", required-15)
	}
}

// covered reports whether the catalog translates the whole message text.
func covered(text, lang string) bool {
	if e, ok := exact[text]; ok {
		return e[lang] != ""
	}
	var raw map[string]entry
	_ = json.Unmarshal(catalogJSON, &raw)
	return raw[text][lang] != ""
}

// translatable is false for messages that are only arguments ("%v", "%s: %v")
// or a machine-readable code.
func translatable(text string) bool {
	return meaningful(verb.ReplaceAllString(text, "")) >= 2 && !code.MatchString(text)
}

var code = regexp.MustCompile(`^[a-z0-9_]+$`)

func TestCatalogTranslationsKeepArguments(t *testing.T) {
	var catalog map[string]entry
	if err := json.Unmarshal(catalogJSON, &catalog); err != nil {
		t.Fatal(err)
	}
	for src, e := range catalog {
		if code.MatchString(src) {
			t.Errorf("%q is a machine-readable code that clients compare; it must not be translated", src)
		}
		if hasHan(src) {
			t.Errorf("%q: catalog keys are the English source messages", src)
		}
		for lang, text := range e {
			if lang != "ja" {
				t.Errorf("%q: unknown language %q", src, lang)
			}
			if verbs(text) != verbs(src) {
				t.Errorf("%q: %s translation has %d arguments, source has %d", src, lang, verbs(text), verbs(src))
			}
		}
	}
}

func fixtures() {
	loadOnce.Do(load)
	exact["Incorrect password"] = entry{"ja": "パスワードが正しくありません"}
	exact["file not found"] = entry{"ja": "ファイルが見つかりません"}
	re, lit := compile("Failed to save %s: %v")
	patterns = append(patterns, pattern{re: re, entry: entry{"ja": "%[2]v のため %[1]s を保存できません"}, literal: lit})
	re, lit = compile("Read failed: %w")
	patterns = append(patterns, pattern{re: re, entry: entry{}, literal: lit}) // a frame with no translation
}

func TestTranslate(t *testing.T) {
	fixtures()
	for _, tc := range []struct{ lang, in, want string }{
		{"en", "Incorrect password", "Incorrect password"},
		{"ja", "Incorrect password", "パスワードが正しくありません"},
		{"zh", "Incorrect password", "Incorrect password"},
		{"ja", "file not found", "ファイルが見つかりません"},
		{"ja", "not in the catalog", "not in the catalog"},
		{"ja", "Failed to save a: file not found", "ファイルが見つかりません のため a を保存できません"},
		{"ja", "Read failed: file not found", "Read failed: ファイルが見つかりません"},
		{"ja", "", ""},
	} {
		if got := Translate(tc.lang, tc.in); got != tc.want {
			t.Errorf("Translate(%q, %q) = %q, want %q", tc.lang, tc.in, got, tc.want)
		}
	}
	if re, _ := compile("%s: %v"); re != nil {
		t.Error("a format with no fixed text must not become a pattern")
	}
}

func TestMiddlewareOnlyRewritesJSONErrors(t *testing.T) {
	fixtures()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Middleware())
	r.GET("/err", func(c *gin.Context) { c.JSON(http.StatusUnauthorized, gin.H{"error": "Incorrect password", "code": 7}) })
	r.GET("/ok", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"error": "Incorrect password"}) })
	r.GET("/text", func(c *gin.Context) { c.String(http.StatusBadRequest, "Incorrect password") })
	r.GET("/stream", func(c *gin.Context) {
		c.Header("Content-Type", "text/event-stream")
		c.Writer.WriteString("data: Incorrect password\n\n")
		c.Writer.Flush()
	})
	r.GET("/unknown", func(c *gin.Context) { c.JSON(http.StatusBadRequest, gin.H{"error": "not in the catalog"}) })
	r.GET("/written", func(c *gin.Context) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "not in the catalog"})
		if !c.Writer.Written() || c.Writer.Size() <= 0 {
			t.Error("a held error body must count as written")
		}
	})

	get := func(path, lang string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if lang != "" {
			req.Header.Set("Accept-Language", lang)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	for _, tc := range []struct {
		path, lang string
		status     int
		want       string
	}{
		{"/err", "", 401, `{"code":7,"error":"Incorrect password"}`},
		{"/err", "ja-JP", 401, `{"code":7,"error":"パスワードが正しくありません"}`},
		{"/err", "zh-CN", 401, `{"code":7,"error":"Incorrect password"}`},
		{"/ok", "ja", 200, `{"error":"Incorrect password"}`},
		{"/text", "ja", 400, "Incorrect password"},
		{"/stream", "ja", 200, "data: Incorrect password\n\n"},
		{"/unknown", "ja", 400, `{"error":"not in the catalog"}`},
		{"/written", "ja", 400, `{"error":"not in the catalog"}`},
	} {
		w := get(tc.path, tc.lang)
		if w.Code != tc.status || w.Body.String() != tc.want {
			t.Errorf("%s [%s] = %d %q, want %d %q", tc.path, tc.lang, w.Code, w.Body.String(), tc.status, tc.want)
		}
		if n := w.Header().Get("Content-Length"); n != "" && n != strconv.Itoa(w.Body.Len()) {
			t.Errorf("%s [%s]: Content-Length %s but body has %d bytes", tc.path, tc.lang, n, w.Body.Len())
		}
	}
}

func TestTranslateSSE(t *testing.T) {
	fixtures()
	for _, tc := range []struct{ lang, in, want string }{
		{"ja", `data: {"type":"error","message":"Incorrect password","data":{"id":1}}` + "\n\n", `data: {"data":{"id":1},"message":"パスワードが正しくありません","type":"error"}` + "\n\n"},
		{"ja", `data: {"type":"progress","message":"Incorrect password"}` + "\n\n", `data: {"message":"パスワードが正しくありません","type":"progress"}` + "\n\n"},
		{"en", `data: {"type":"error","message":"Incorrect password"}` + "\n\n", `data: {"type":"error","message":"Incorrect password"}` + "\n\n"},
		// model output is never rewritten, even when it equals a catalog message
		{"ja", `data: {"type":"response","message":"Incorrect password"}` + "\n\n", `data: {"type":"response","message":"Incorrect password"}` + "\n\n"},
		{"ja", ": keepalive\n\n", ": keepalive\n\n"},
	} {
		if got := string(TranslateSSE(tc.lang, []byte(tc.in))); got != tc.want {
			t.Errorf("TranslateSSE(%q, %q) = %q, want %q", tc.lang, tc.in, got, tc.want)
		}
	}
}
