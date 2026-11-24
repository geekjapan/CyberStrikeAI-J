package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
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
	if got := i18nText("ja", "中", "en", "日"); got != "日" {
		t.Errorf("i18nText ja = %q", got)
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
