package handler

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRequestOutputLanguage(t *testing.T) {
	for _, tc := range []struct{ query, header, want string }{
		{"", "", ""},
		{"", "ja-JP", "ja"},
		{"", "en-US", "en"},
		{"", "zh-CN", "en"},
		{"ja", "en-US", "ja"},
	} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("POST", "/api/agent/stream?lang="+tc.query, nil)
		if tc.header != "" {
			c.Request.Header.Set("Accept-Language", tc.header)
		}
		if got := requestOutputLanguage(c); got != tc.want {
			t.Errorf("lang=%q Accept-Language=%q: got %q, want %q", tc.query, tc.header, got, tc.want)
		}
	}
}

func TestChatPromptExtraPinsOutputLanguage(t *testing.T) {
	h := &AgentHandler{}
	ja := h.chatPromptExtra("", &ChatRequest{OutputLanguage: "ja"})
	if !strings.Contains(ja, "Output language:") || !strings.Contains(ja, "in Japanese") {
		t.Fatalf("Japanese UI must pin Japanese output, got %q", ja)
	}
	if en := h.chatPromptExtra("", &ChatRequest{OutputLanguage: "en"}); !strings.Contains(en, "in English") {
		t.Fatalf("English UI must pin English output, got %q", en)
	}
	if none := h.chatPromptExtra("", &ChatRequest{}); strings.Contains(none, "Output language:") {
		t.Fatalf("a request without a language must not pin one, got %q", none)
	}
}
