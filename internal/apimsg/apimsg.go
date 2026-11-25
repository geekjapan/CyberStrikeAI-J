// Package apimsg translates the human-readable messages the server sends to
// clients.  The source code writes messages in English; catalog.json maps each
// English message to Japanese ("ja").  The middleware
// rewrites the "error" / "message" fields of JSON error responses, and
// TranslateSSE does the same for stream events.  Text that is not in the
// catalog passes through unchanged.
package apimsg

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode"

	"github.com/gin-gonic/gin"
)

//go:embed catalog.json
var catalogJSON []byte

// entry holds the translations of one source message.  A missing language
// means "show the source text".
type entry map[string]string

type pattern struct {
	re      *regexp.Regexp
	entry   entry
	literal int // length of the fixed text, longer patterns match first
}

var (
	loadOnce sync.Once
	exact    map[string]entry
	patterns []pattern
)

// verb matches one fmt verb such as %s, %v, %+v, %q, %d, %5.2f, %[1]s, or %%.
var verb = regexp.MustCompile(`%(?:%|(?:\[(\d+)\])?[+\-# 0]*\d*(?:\.\d+)?[a-zA-Z])`)

func load() {
	var raw map[string]entry
	if err := json.Unmarshal(catalogJSON, &raw); err != nil {
		panic("apimsg: catalog.json: " + err.Error())
	}
	exact = make(map[string]entry, len(raw))
	for source, e := range raw {
		if !strings.Contains(source, "%") {
			exact[source] = e
			continue
		}
		re, literal := compile(source)
		if re == nil {
			continue
		}
		patterns = append(patterns, pattern{re: re, entry: e, literal: literal})
	}
	sort.SliceStable(patterns, func(i, j int) bool { return patterns[i].literal > patterns[j].literal })
}

// compile turns a fmt format string into a regexp with one group per verb.
// Formats with almost no fixed text ("%s: %v") would match anything and are
// rejected.
func compile(format string) (*regexp.Regexp, int) {
	var b strings.Builder
	b.WriteString(`(?s)^`)
	literal, last := 0, 0
	for _, loc := range verb.FindAllStringIndex(format, -1) {
		text := format[last:loc[0]]
		literal += meaningful(text)
		b.WriteString(regexp.QuoteMeta(text))
		if format[loc[0]:loc[1]] == "%%" {
			b.WriteString("%")
		} else {
			b.WriteString(`(.*?)`)
		}
		last = loc[1]
	}
	text := format[last:]
	literal += meaningful(text)
	b.WriteString(regexp.QuoteMeta(text))
	b.WriteString(`$`)
	if literal < 2 {
		return nil, 0
	}
	re, err := regexp.Compile(b.String())
	if err != nil {
		return nil, 0
	}
	return re, literal
}

func meaningful(s string) int {
	n := 0
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			n++
		}
	}
	return n
}

// Lang maps a request to "ja" or "en" (the default): the lang query
// parameter wins over Accept-Language.
func Lang(c *gin.Context) string {
	if c == nil {
		return "en"
	}
	lang := strings.ToLower(strings.TrimSpace(c.Query("lang")))
	if lang == "" {
		lang = strings.ToLower(strings.TrimSpace(c.GetHeader("Accept-Language")))
	}
	if strings.HasPrefix(lang, "ja") {
		return "ja"
	}
	return "en"
}

// Translate returns msg in lang, or msg itself when the catalog has no entry.
func Translate(lang, msg string) string {
	return translate(lang, msg, 0)
}

func translate(lang, msg string, depth int) string {
	if msg == "" || lang == "en" || depth > 3 {
		return msg
	}
	loadOnce.Do(load)
	if e, ok := exact[msg]; ok {
		if t := e[lang]; t != "" {
			return t
		}
		return msg
	}
	for _, p := range patterns {
		groups := p.re.FindStringSubmatch(msg)
		if groups == nil {
			continue
		}
		args := groups[1:]
		for i := range args {
			// A wrapped error is often a catalog message itself.
			args[i] = translate(lang, args[i], depth+1)
		}
		t := p.entry[lang]
		if t == "" {
			// No translation of the frame, but the wrapped parts may have one.
			return rebuild(p.re, msg, args)
		}
		return fill(t, args)
	}
	return msg
}

// fill replaces the verbs of a translated format with the captured arguments,
// in order, or by explicit index (%[2]s).
func fill(format string, args []string) string {
	next := 0
	return verb.ReplaceAllStringFunc(format, func(v string) string {
		if v == "%%" {
			return "%"
		}
		i := next
		if m := verb.FindStringSubmatch(v); m[1] != "" {
			n, _ := strconv.Atoi(m[1])
			i = n - 1
		}
		next = i + 1
		if i < 0 || i >= len(args) {
			return ""
		}
		return args[i]
	})
}

// rebuild puts translated arguments back into the untranslated source text.
func rebuild(re *regexp.Regexp, msg string, args []string) string {
	loc := re.FindStringSubmatchIndex(msg)
	var b strings.Builder
	last := 0
	for i := range args {
		start, end := loc[2*(i+1)], loc[2*(i+1)+1]
		b.WriteString(msg[last:start])
		b.WriteString(args[i])
		last = end
	}
	b.WriteString(msg[last:])
	return b.String()
}

// bufferingWriter holds back JSON error bodies so they can be rewritten.
// Every other response (success, streams, downloads) is written through
// untouched.
type bufferingWriter struct {
	gin.ResponseWriter
	buf    bytes.Buffer
	holds  bool
	decide bool
}

func (w *bufferingWriter) hold() bool {
	if !w.decide {
		w.decide = true
		w.holds = w.Status() >= 400 &&
			strings.HasPrefix(w.Header().Get("Content-Type"), "application/json")
	}
	return w.holds
}

func (w *bufferingWriter) Write(p []byte) (int, error) {
	if w.hold() {
		return w.buf.Write(p)
	}
	return w.ResponseWriter.Write(p)
}

func (w *bufferingWriter) WriteString(s string) (int, error) {
	if w.hold() {
		return w.buf.WriteString(s)
	}
	return w.ResponseWriter.WriteString(s)
}

// A held body is still a written response for handlers that ask.
func (w *bufferingWriter) Written() bool {
	return w.buf.Len() > 0 || w.ResponseWriter.Written()
}

func (w *bufferingWriter) Size() int {
	if w.buf.Len() > 0 {
		return w.buf.Len()
	}
	return w.ResponseWriter.Size()
}

// Middleware translates the "error" and "message" strings of JSON responses
// with status >= 400.  Requests in English are passed through unchanged.
func Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		lang := Lang(c)
		if lang == "en" {
			c.Next()
			return
		}
		w := &bufferingWriter{ResponseWriter: c.Writer}
		c.Writer = w
		c.Next()
		c.Writer = w.ResponseWriter
		if !w.holds {
			return
		}
		body := w.buf.Bytes()
		if translated, ok := translateBody(lang, body); ok {
			body = translated
			w.ResponseWriter.Header().Del("Content-Length")
		}
		_, _ = w.ResponseWriter.Write(body)
	}
}

func translateBody(lang string, body []byte) ([]byte, bool) {
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, false
	}
	changed := false
	for _, key := range []string{"error", "message"} {
		var text string
		if json.Unmarshal(payload[key], &text) != nil || text == "" {
			continue
		}
		if t := Translate(lang, text); t != text {
			raw, _ := json.Marshal(t)
			payload[key] = raw
			changed = true
		}
	}
	if !changed {
		return nil, false
	}
	out, err := json.Marshal(payload)
	if err != nil {
		return nil, false
	}
	return out, true
}

// sseContent lists the stream event types whose "message" is model, tool or
// user content.  The message of every other type is written by the server.
var sseContent = map[string]bool{
	"response": true, "response_start": true, "response_delta": true, "agent_reply": true,
	"thinking": true, "thinking_stream_start": true, "thinking_stream_delta": true,
	"reasoning_chain": true, "reasoning_chain_stream_start": true, "reasoning_chain_stream_delta": true,
	"tool_result": true, "workflow_agent_output": true, "message_saved": true, "conversation": true,
	"heartbeat": true, "done": true,
}

// TranslateEvent returns the message of a stream or process-detail event of
// the given type in lang.  Content written by a model or a tool is returned
// as it is.
func TranslateEvent(lang, kind, message string) string {
	if sseContent[kind] {
		return message
	}
	return Translate(lang, message)
}

// TranslateReply translates an assistant message that is a server-written
// notice (a failed or cancelled run).  A real reply never matches the catalog;
// long text is skipped without looking.
func TranslateReply(lang, content string) string {
	if len(content) > 2000 {
		return content
	}
	return Translate(lang, content)
}

// TranslateSSE returns one "data: {...}\n\n" stream line with its message in
// lang.  Lines it does not understand are returned as they are.
func TranslateSSE(lang string, line []byte) []byte {
	const prefix = "data: "
	if lang == "en" || !bytes.HasPrefix(line, []byte(prefix)) {
		return line
	}
	var event map[string]json.RawMessage
	if json.Unmarshal(bytes.TrimSpace(line[len(prefix):]), &event) != nil {
		return line
	}
	var kind, message string
	if json.Unmarshal(event["type"], &kind) != nil {
		return line
	}
	if json.Unmarshal(event["message"], &message) != nil || message == "" {
		return line
	}
	translated := TranslateEvent(lang, kind, message)
	if translated == message {
		return line
	}
	event["message"], _ = json.Marshal(translated)
	body, err := json.Marshal(event)
	if err != nil {
		return line
	}
	return append(append([]byte(prefix), body...), '\n', '\n')
}
