package handler

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/robot/ilink"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const wechatLoginTTL = 5 * time.Minute

// WechatConfigSaver saves the config after binding succeeds and restarts the bot connection
type WechatConfigSaver interface {
	ApplyWechatRobotBinding(cfg config.RobotWechatConfig) error
}

type wechatLoginSession struct {
	QRCode         string
	QRCodeImgURL   string
	PendingVerify  string
	CurrentBaseURL string
	StartedAt      time.Time
}

// WechatRobotHandler is the WeChat iLink bot (QR code binding + configuration)
type WechatRobotHandler struct {
	config      *config.Config
	configSaver WechatConfigSaver
	logger      *zap.Logger
	mu          sync.Mutex
	logins      map[string]*wechatLoginSession
}

// NewWechatRobotHandler creates the WeChat bot handler
func NewWechatRobotHandler(cfg *config.Config, saver WechatConfigSaver, logger *zap.Logger) *WechatRobotHandler {
	return &WechatRobotHandler{
		config:      cfg,
		configSaver: saver,
		logger:      logger,
		logins:      make(map[string]*wechatLoginSession),
	}
}

func (h *WechatRobotHandler) purgeExpiredLogins() {
	now := time.Now()
	for k, v := range h.logins {
		if now.Sub(v.StartedAt) > wechatLoginTTL {
			delete(h.logins, k)
		}
	}
}

func (h *WechatRobotHandler) ilinkClient(baseURL string) *ilink.Client {
	ver := h.config.Version
	if ver == "" {
		ver = "1.0.0"
	}
	ver = strings.TrimPrefix(strings.TrimSpace(ver), "v")
	ver = strings.TrimPrefix(ver, "V")
	wc := h.config.Robots.Wechat
	return ilink.NewClient(baseURL, wc.BotToken, wc.BotAgent, ilink.BuildClientVersion(ver))
}

// HandleWechatQRCode POST /api/robot/wechat/qrcode — generates the binding QR code
func (h *WechatRobotHandler) HandleWechatQRCode(c *gin.Context) {
	h.mu.Lock()
	h.purgeExpiredLogins()
	h.mu.Unlock()

	var req struct {
		BotType string `json:"bot_type"`
	}
	_ = c.ShouldBindJSON(&req)

	botType := req.BotType
	if botType == "" {
		botType = h.config.Robots.Wechat.BotType
	}
	if botType == "" {
		botType = ilink.DefaultBotType
	}
	baseURL := h.config.Robots.Wechat.BaseURL
	if baseURL == "" {
		baseURL = ilink.DefaultBaseURL
	}

	var localTokens []string
	if t := h.config.Robots.Wechat.BotToken; t != "" {
		localTokens = []string{t}
	}

	client := h.ilinkClient(baseURL)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	qr, err := client.GetBotQRCode(ctx, botType, localTokens)
	if err != nil {
		h.logger.Warn("Failed to get WeChat QR code", zap.Error(err))
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to get QR code: " + err.Error()})
		return
	}
	if qr.QRCode == "" || qr.QRCodeImgContent == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "WeChat server did not return a valid QR code"})
		return
	}

	sessionKey := uuid.New().String()
	h.mu.Lock()
	h.logins[sessionKey] = &wechatLoginSession{
		QRCode:         qr.QRCode,
		QRCodeImgURL:   qr.QRCodeImgContent,
		CurrentBaseURL: baseURL,
		StartedAt:      time.Now(),
	}
	h.mu.Unlock()

	resp := gin.H{
		"session_key":     sessionKey,
		"qrcode":          qr.QRCode,
		"qrcode_open_url": qr.QRCodeImgContent,
		"message":         "Scan the QR code with WeChat and confirm the binding",
	}
	if dataURL, err := ilink.QRCodeDataURL(qr.QRCodeImgContent, 256); err != nil {
		h.logger.Warn("Failed to generate QR code image", zap.Error(err))
	} else {
		resp["qrcode_image_data_url"] = dataURL
	}

	c.JSON(http.StatusOK, resp)
}

// HandleWechatQRCodeStatus GET /api/robot/wechat/qrcode/status — polls the scan status
func (h *WechatRobotHandler) HandleWechatQRCodeStatus(c *gin.Context) {
	sessionKey := c.Query("session_key")
	verifyCode := c.Query("verify_code")
	if sessionKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session_key is missing"})
		return
	}

	h.mu.Lock()
	sess, ok := h.logins[sessionKey]
	h.mu.Unlock()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Login session not found or expired; please regenerate the QR code"})
		return
	}
	if time.Since(sess.StartedAt) > wechatLoginTTL {
		h.mu.Lock()
		delete(h.logins, sessionKey)
		h.mu.Unlock()
		c.JSON(http.StatusGone, gin.H{"error": "QR code expired; please regenerate it"})
		return
	}

	baseURL := sess.CurrentBaseURL
	if baseURL == "" {
		baseURL = ilink.DefaultBaseURL
	}
	vc := verifyCode
	if vc == "" {
		vc = sess.PendingVerify
	}

	client := h.ilinkClient(baseURL)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 40*time.Second)
	defer cancel()

	st, err := client.GetQRCodeStatus(ctx, sess.QRCode, vc)
	if err != nil {
		h.logger.Warn("Failed to poll WeChat QR code status", zap.Error(err))
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	switch st.Status {
	case "wait", "scaned":
		c.JSON(http.StatusOK, gin.H{"status": st.Status})
		return
	case "need_verifycode":
		c.JSON(http.StatusOK, gin.H{
			"status":  st.Status,
			"message": "Check the pairing digits in WeChat on your phone and enter them below",
		})
		return
	case "scaned_but_redirect":
		if st.RedirectHost != "" {
			h.mu.Lock()
			if s, ok := h.logins[sessionKey]; ok {
				s.CurrentBaseURL = "https://" + st.RedirectHost
			}
			h.mu.Unlock()
		}
		c.JSON(http.StatusOK, gin.H{"status": st.Status})
		return
	case "binded_redirect":
		h.mu.Lock()
		delete(h.logins, sessionKey)
		h.mu.Unlock()
		c.JSON(http.StatusOK, gin.H{
			"status":            st.Status,
			"already_connected": true,
			"message":           "This WeChat account is already bound; no need to bind again",
		})
		return
	case "confirmed":
		if st.BotToken == "" || st.ILinkBotID == "" {
			c.JSON(http.StatusBadGateway, gin.H{"error": "Binding confirmed but bot_token is missing"})
			return
		}
		saveBase := st.BaseURL
		if saveBase == "" {
			saveBase = baseURL
		}
		wc := h.config.Robots.Wechat
		wc.Enabled = true
		wc.BotToken = st.BotToken
		wc.ILinkBotID = st.ILinkBotID
		wc.ILinkUserID = st.ILinkUserID
		wc.BaseURL = saveBase
		if wc.BotType == "" {
			wc.BotType = ilink.DefaultBotType
		}
		if wc.BotAgent == "" {
			wc.BotAgent = ilink.DefaultBotAgent
		}
		if h.configSaver != nil {
			if err := h.configSaver.ApplyWechatRobotBinding(wc); err != nil {
				h.logger.Warn("Failed to save WeChat bot configuration", zap.Error(err))
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save config: " + err.Error()})
				return
			}
		} else {
			h.config.Robots.Wechat = wc
		}
		h.mu.Lock()
		delete(h.logins, sessionKey)
		h.mu.Unlock()
		c.JSON(http.StatusOK, gin.H{
			"status":        "confirmed",
			"message":       "Binding succeeded; WeChat bot enabled",
			"ilink_bot_id":  st.ILinkBotID,
			"ilink_user_id": st.ILinkUserID,
		})
		return
	default:
		c.JSON(http.StatusOK, gin.H{"status": st.Status})
	}
}

// HandleWechatVerifyCode POST /api/robot/wechat/qrcode/verify — submits the phone pairing number
func (h *WechatRobotHandler) HandleWechatVerifyCode(c *gin.Context) {
	var req struct {
		SessionKey string `json:"session_key"`
		VerifyCode string `json:"verify_code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.SessionKey == "" || req.VerifyCode == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "session_key and verify_code are required"})
		return
	}
	h.mu.Lock()
	sess, ok := h.logins[req.SessionKey]
	if ok {
		sess.PendingVerify = req.VerifyCode
	}
	h.mu.Unlock()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Login session not found or expired"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Pairing code submitted; please keep waiting for binding"})
}

// HandleWechatStatus GET /api/robot/wechat/status — current binding status (for frontend display)
func (h *WechatRobotHandler) HandleWechatStatus(c *gin.Context) {
	wc := h.config.Robots.Wechat
	bound := wc.BotToken != "" && wc.ILinkBotID != ""
	c.JSON(http.StatusOK, gin.H{
		"enabled":       wc.Enabled,
		"bound":         bound,
		"ilink_bot_id":  wc.ILinkBotID,
		"ilink_user_id": wc.ILinkUserID,
		"base_url":      wc.BaseURL,
	})
}
