package handler

import (
	"bytes"
	"context"
	"crypto/rand"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"regexp"
	"strings"
	"time"

	"cyberstrike-ai/internal/agentruntime"
	"cyberstrike-ai/internal/multiagent"

	"github.com/gin-gonic/gin"
	"golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
)

var imageProbeCode = regexp.MustCompile(`\b[2-9]{6}\b`)

func (h *ConfigHandler) testChannelImage(c *gin.Context, req TestOpenAIRequest, headers map[string]string) {
	h.mu.RLock()
	model, _, _ := h.config.ResolveAIChannel(req.ChannelID)
	runtime := h.config.AgentRuntime
	h.mu.RUnlock()
	model.Provider, model.BaseURL, model.Model = req.Provider, req.BaseURL, strings.TrimSpace(req.Model)
	model.APIKey, model.Headers, model.ContextProfile = req.APIKey, headers, req.ContextProfile

	var digits [6]byte
	_, _ = rand.Read(digits[:])
	for i := range digits {
		digits[i] = '2' + digits[i]%8
	}
	code := string(digits[:])
	small := image.NewRGBA(image.Rect(0, 0, 58, 24))
	draw.Draw(small, small.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	label := font.Drawer{Dst: small, Src: image.NewUniform(color.Black), Face: basicfont.Face7x13, Dot: fixed.P(8, 17)}
	label.DrawString(code)
	large := image.NewRGBA(image.Rect(0, 0, 464, 192))
	draw.NearestNeighbor.Scale(large, large.Bounds(), small, small.Bounds(), draw.Src, nil)
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, large); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate test image"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 35*time.Second)
	defer cancel()
	started := time.Now()
	result, err := multiagent.ProbeImageInput(ctx, runtime, model, agentruntime.Image{MIMEType: "image/png", Data: encoded.Bytes()})
	response := gin.H{"success": false, "model": model.Model, "latency_ms": time.Since(started).Milliseconds()}
	switch {
	case err != nil || result == nil || result.Status != "completed":
		response["error"] = "Image request failed. Confirm that the model and API protocol of the current channel support image input"
	case !matchesImageProbeCode(result.Response, code):
		response["error"] = "The model did not read the characters in the test image correctly"
	default:
		response["success"] = true
	}
	c.JSON(http.StatusOK, response)
}

func matchesImageProbeCode(response, expected string) bool {
	codes := imageProbeCode.FindAllString(response, 2)
	return len(codes) == 1 && codes[0] == expected
}
