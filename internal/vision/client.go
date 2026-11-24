package vision

import (
	"context"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/openai"
)

// Client calls the standalone Vision ChatModel (a single Generate).
type Client struct {
	cfg    config.VisionConfig
	mainOA config.OpenAIConfig
}

// NewClient constructs the vision client.
func NewClient(visionCfg config.VisionConfig, mainOpenAI config.OpenAIConfig) *Client {
	return &Client{cfg: visionCfg, mainOA: mainOpenAI}
}

// Analyze sends the image bytes to the VL model and returns a text description.
func (c *Client) Analyze(ctx context.Context, img ImagePayload, question string) (string, error) {
	if len(img.Bytes) == 0 {
		return "", fmt.Errorf("empty image payload")
	}
	mime := strings.TrimSpace(img.MIMEType)
	if mime == "" {
		mime = "image/jpeg"
	}
	oa := c.cfg.OpenAICfgEffective(c.mainOA)
	if strings.TrimSpace(oa.APIKey) == "" {
		return "", fmt.Errorf("vision API key is empty (set vision.api_key or openai.api_key)")
	}
	if strings.TrimSpace(oa.Model) == "" {
		return "", fmt.Errorf("vision model is empty")
	}

	timeout := time.Duration(c.cfg.TimeoutSecondsEffective()) * time.Second
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	httpClient := &http.Client{
		Timeout: timeout + 15*time.Second,
		Transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout:   60 * time.Second,
				KeepAlive: 60 * time.Second,
			}).DialContext,
			ResponseHeaderTimeout: timeout + 10*time.Second,
		},
	}

	b64 := base64.StdEncoding.EncodeToString(img.Bytes)
	payload := map[string]any{"model": oa.Model, "max_completion_tokens": oa.MaxCompletionTokensEffective(), "messages": []map[string]any{{"role": "user", "content": []map[string]any{{"type": "text", "text": buildVisionPrompt(question)}, {"type": "image_url", "image_url": map[string]any{"url": "data:" + mime + ";base64," + b64, "detail": c.cfg.DetailEffective()}}}}}}
	var reply struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	client := openai.NewClient(&oa, httpClient, nil)
	if err := client.ChatCompletion(ctx, payload, &reply); err != nil {
		return "", err
	}
	if len(reply.Choices) == 0 || strings.TrimSpace(reply.Choices[0].Message.Content) == "" {
		return "", fmt.Errorf("vision model returned empty content")
	}
	return strings.TrimSpace(reply.Choices[0].Message.Content), nil
}

func buildVisionPrompt(question string) string {
	q := strings.TrimSpace(question)
	if q == "" {
		q = "Describe the image in general terms, focusing on authorized security testing scenarios (visible text, forms, buttons, captchas, error messages, tech stack clues)."
	}
	extra := ""
	if looksLikeCaptchaQuestion(q) {
		extra = "\nIf it is a captcha: output only the character sequence you recognized, with no spaces, punctuation or explanation; if it is unreadable, state clearly that it cannot be recognized."
	}
	return `You are an authorized security testing assistant. Answer the user's question based on the image, describe only what you can confirm from the image, and do not make anything up.
User question: ` + q + extra
}

func looksLikeCaptchaQuestion(q string) bool {
	s := strings.ToLower(q)
	for _, kw := range []string{"验证码", "captcha", "verification code", "verify code", "vcode", "图形码"} {
		if strings.Contains(s, kw) {
			return true
		}
	}
	// The Chinese words match questions written in Chinese.
	onlyOutput := strings.Contains(s, "output only") || strings.Contains(s, "only output") || strings.Contains(s, "只输出")
	return onlyOutput && (strings.Contains(s, "字符") || strings.Contains(s, "character"))
}
