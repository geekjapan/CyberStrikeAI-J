package handler

import (
	"bytes"
	"os/exec"
	"strconv"
	"unicode"
	"unicode/utf8"

	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRequestLang(t *testing.T) {
	for _, tc := range []struct{ query, header, want string }{
		{"ja-JP", "", "ja"}, {"en-US", "ja", "en"}, {"zh-CN", "en", "zh"},
		{"", "ja,en;q=0.8", "ja"}, {"", "", "en"}, {"ru-RU", "", "en"},
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodGet, "/?lang="+tc.query, nil)
		c.Request.Header.Set("Accept-Language", tc.header)
		if got := requestLang(c); got != tc.want {
			t.Errorf("lang=%q header=%q: got %q, want %q", tc.query, tc.header, got, tc.want)
		}
	}
}

// ja-JP 必须覆盖 en-US 与 zh-CN 的全部词条，且占位符一致，否则界面会回退成中文。
func TestJapaneseLocaleCoversSourceLocales(t *testing.T) {
	load := func(lang string) map[string]string {
		raw, err := os.ReadFile("../../web/static/i18n/" + lang + ".json")
		if err != nil {
			t.Fatal(err)
		}
		var tree map[string]any
		if err := json.Unmarshal(raw, &tree); err != nil {
			t.Fatalf("%s: %v", lang, err)
		}
		flat := map[string]string{}
		var walk func(prefix string, node map[string]any)
		walk = func(prefix string, node map[string]any) {
			for k, v := range node {
				if strings.Contains(k, ".") {
					// 前端按 . 拆分查找，带点的键名永远取不到。
					t.Errorf("%s: key %q under %q contains a dot; nest it instead", lang, k, prefix)
				}
				switch v := v.(type) {
				case map[string]any:
					walk(prefix+k+".", v)
				case string:
					flat[prefix+k] = v
				default:
					t.Errorf("%s: %s%s is not a string", lang, prefix, k)
				}
			}
		}
		walk("", tree)
		return flat
	}
	placeholder := regexp.MustCompile(`\{\{\s*(\w+)\s*\}\}`)
	vars := func(s string) string {
		var names []string
		for _, m := range placeholder.FindAllStringSubmatch(s, -1) {
			names = append(names, m[1])
		}
		sort.Strings(names)
		return strings.Join(names, ",")
	}
	ja, en, zh := load("ja-JP"), load("en-US"), load("zh-CN")
	for _, source := range []map[string]string{zh, en} { // en 后查，同名键以 en 为准
		for key, text := range source {
			got, ok := ja[key]
			if !ok || strings.TrimSpace(got) == "" {
				t.Errorf("ja-JP missing %s", key)
				continue
			}
			if _, inEn := en[key]; inEn {
				text = en[key]
			}
			if vars(got) != vars(text) {
				t.Errorf("ja-JP %s placeholders {%s}, want {%s}", key, vars(got), vars(text))
			}
		}
	}
}

// 前端源码里用字面量引用的词条必须存在于 en-US.json，否则英文/日文界面会退回源码里的中文兜底。
func TestFrontendKeysExistInEnglishLocale(t *testing.T) {
	raw, err := os.ReadFile("../../web/static/i18n/en-US.json")
	if err != nil {
		t.Fatal(err)
	}
	var tree map[string]any
	if err := json.Unmarshal(raw, &tree); err != nil {
		t.Fatal(err)
	}
	has := func(key string) bool {
		var node any = tree
		for _, part := range strings.Split(key, ".") {
			m, ok := node.(map[string]any)
			if !ok {
				return false
			}
			node = m[part]
		}
		_, ok := node.(string)
		return ok
	}
	// t('a.b', ...) / translate('a.b')；后面接 + 的是运行时拼接的前缀，不检查。
	call := regexp.MustCompile(`\b(?:t|translate)\(\s*['"]([A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+)+)['"]\s*[,)]`)
	missing := map[string]string{}
	err = filepath.WalkDir("../../web/frontend/src", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || (!strings.HasSuffix(path, ".js") && !strings.HasSuffix(path, ".jsx")) {
			return err
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, m := range call.FindAllSubmatch(src, -1) {
			if key := string(m[1]); !has(key) {
				missing[key] = strings.TrimPrefix(path, "../../")
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	keys := make([]string, 0, len(missing))
	for key := range missing {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		t.Errorf("en-US.json has no %q (used in %s)", key, missing[key])
	}
}

// The repository is written in English.  Chinese (and Japanese) text lives in
// the translation resources, and in the few data lines that must be Chinese to
// work (keywords matching Chinese input, query examples, CJK test payloads).
// testdata/cjk_allowlist.txt lists them: "dir/ *" allows a whole tree,
// "path N" allows exactly N lines containing Han characters.  After a
// deliberate change, regenerate the per-file counts with
//
//	UPDATE_CJK_ALLOWLIST=1 go test ./internal/handler -run TestRepositoryIsEnglish
//
// and review the diff of the allowlist.
func TestRepositoryIsEnglish(t *testing.T) {
	root := filepath.Join("..", "..")
	const listPath = "testdata/cjk_allowlist.txt"
	raw, err := os.ReadFile(listPath)
	if err != nil {
		t.Fatal(err)
	}
	var trees, header []string
	allowed := map[string]int{}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		switch {
		case len(fields) == 0 || strings.HasPrefix(fields[0], "#"):
			if len(allowed) == 0 {
				header = append(header, line)
			}
		case len(fields) >= 2 && fields[1] == "*":
			trees = append(trees, fields[0])
			header = append(header, line)
		case len(fields) >= 2:
			// The count is the last field; a path may contain spaces.
			last := fields[len(fields)-1]
			n, err := strconv.Atoi(last)
			if err != nil {
				t.Fatalf("%s: bad line %q", listPath, line)
			}
			allowed[strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(line), last))] = n
		}
	}
	out, err := exec.Command("git", "-C", root, "ls-files", "-co", "--exclude-standard", "-z").Output()
	if err != nil {
		t.Skipf("git ls-files: %v", err)
	}
	found := map[string]int{}
files:
	for _, path := range strings.Split(string(out), "\x00") {
		if path == "" {
			continue
		}
		for _, tree := range trees {
			if path == tree || strings.HasPrefix(path, tree) {
				continue files
			}
		}
		data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(path)))
		if err != nil || len(data) > 4<<20 || bytes.IndexByte(data, 0) >= 0 || !utf8.Valid(data) {
			continue
		}
		for _, line := range bytes.Split(data, []byte("\n")) {
			if bytes.IndexFunc(line, func(r rune) bool { return unicode.Is(unicode.Han, r) }) >= 0 {
				found[path]++
			}
		}
		if strings.IndexFunc(path, func(r rune) bool { return unicode.Is(unicode.Han, r) }) >= 0 {
			t.Errorf("%s: file names must be English", path)
		}
	}
	if os.Getenv("UPDATE_CJK_ALLOWLIST") != "" {
		paths := make([]string, 0, len(found))
		for path := range found {
			paths = append(paths, path)
		}
		sort.Strings(paths)
		lines := append([]string{}, header...)
		for len(lines) > 0 && lines[len(lines)-1] == "" {
			lines = lines[:len(lines)-1]
		}
		lines = append(lines, "")
		for _, path := range paths {
			lines = append(lines, path+" "+strconv.Itoa(found[path]))
		}
		if err := os.WriteFile(listPath, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	for path, n := range found {
		if n != allowed[path] {
			t.Errorf("%s: %d lines contain Chinese/Japanese characters, the allowlist has %d. Write source text in English and put translations in web/static/i18n or internal/apimsg/catalog.json.", path, n, allowed[path])
		}
	}
	for path, n := range allowed {
		if found[path] == 0 && n > 0 {
			t.Errorf("%s: no longer contains such lines; remove it from %s", path, listPath)
		}
	}
}
