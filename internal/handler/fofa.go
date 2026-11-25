package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"cyberstrike-ai/internal/config"
	openaiClient "cyberstrike-ai/internal/openai"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

type FofaHandler struct {
	cfg          *config.Config
	logger       *zap.Logger
	client       *http.Client
	openAIClient *openaiClient.Client
}

func NewFofaHandler(cfg *config.Config, logger *zap.Logger) *FofaHandler {
	// LLM requests are usually a bit slower than FOFA queries, so they get a separate, looser timeout.
	llmHTTPClient := &http.Client{Timeout: 2 * time.Minute}
	var llmCfg *config.OpenAIConfig
	if cfg != nil {
		llmCfg = &cfg.OpenAI
	}
	return &FofaHandler{
		cfg:          cfg,
		logger:       logger,
		client:       &http.Client{Timeout: 60 * time.Second},
		openAIClient: openaiClient.NewClient(llmCfg, llmHTTPClient, logger),
	}
}

type fofaSearchRequest struct {
	Provider string `json:"provider,omitempty"`
	Query    string `json:"query" binding:"required"`
	Size     int    `json:"size,omitempty"`
	Page     int    `json:"page,omitempty"`
	Fields   string `json:"fields,omitempty"`
	Full     bool   `json:"full,omitempty"`
}

type fofaParseRequest struct {
	Provider string `json:"provider,omitempty"`
	Text     string `json:"text" binding:"required"`
}

type fofaParseResponse struct {
	Query       string   `json:"query"`
	Explanation string   `json:"explanation,omitempty"`
	Warnings    []string `json:"warnings,omitempty"`
}

type fofaAPIResponse struct {
	Error   bool            `json:"error"`
	ErrMsg  string          `json:"errmsg"`
	Size    int             `json:"size"`
	Page    int             `json:"page"`
	Total   int             `json:"total"`
	Mode    string          `json:"mode"`
	Query   string          `json:"query"`
	Results [][]interface{} `json:"results"`
}

type fofaSearchResponse struct {
	Provider      string                   `json:"provider,omitempty"`
	Query         string                   `json:"query"`
	Size          int                      `json:"size"`
	Page          int                      `json:"page"`
	Total         int                      `json:"total"`
	Fields        []string                 `json:"fields"`
	ResultsCount  int                      `json:"results_count"`
	ExpectedCount int                      `json:"expected_count,omitempty"`
	Shortfall     int                      `json:"shortfall,omitempty"`
	Warning       string                   `json:"warning,omitempty"`
	Results       []map[string]interface{} `json:"results"`
}

type spaceSearchEnvelope struct {
	Code       interface{}     `json:"code"`
	Message    string          `json:"message"`
	Error      string          `json:"error"`
	Query      string          `json:"query"`
	Total      int             `json:"total"`
	TotalCount int             `json:"total_count"`
	Page       int             `json:"page"`
	PageSize   int             `json:"pagesize"`
	Data       json.RawMessage `json:"data"`
	Matches    json.RawMessage `json:"matches"`
	Meta       struct {
		Pagination struct {
			Total int `json:"total"`
		} `json:"pagination"`
	} `json:"meta"`
}

func normalizeSpaceSearchProvider(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "", "fofa":
		return "fofa"
	case "zoomeye", "zoom-eye":
		return "zoomeye"
	case "quake":
		return "quake"
	case "shodan":
		return "shodan"
	default:
		return ""
	}
}

func providerDisplayName(provider string) string {
	switch normalizeSpaceSearchProvider(provider) {
	case "zoomeye":
		return "ZoomEye"
	case "quake":
		return "Quake"
	case "shodan":
		return "Shodan"
	default:
		return "FOFA"
	}
}

func defaultFieldsForProvider(provider string) string {
	switch normalizeSpaceSearchProvider(provider) {
	case "zoomeye":
		return "ip,port,domain,hostname,title,service,app,country,city"
	case "quake":
		return "ip,port,domain,service.name,service.http.title,location.country_cn,location.province_cn,location.city_cn"
	case "shodan":
		return "ip_str,port,hostnames,domains,org,isp,location.country_name,location.city,product,transport"
	default:
		return "host,ip,port,domain,title,protocol,country,region,city,server"
	}
}

func (h *FofaHandler) resolveAPIKey(provider string) string {
	// Environment variables take priority (for container deployment), followed by the config file.
	provider = normalizeSpaceSearchProvider(provider)
	envKey := map[string]string{
		"fofa":    "FOFA_API_KEY",
		"zoomeye": "ZOOMEYE_API_KEY",
		"quake":   "QUAKE_API_KEY",
		"shodan":  "SHODAN_API_KEY",
	}[provider]
	if apiKey := strings.TrimSpace(os.Getenv(envKey)); apiKey != "" {
		return apiKey
	}
	if h.cfg != nil {
		switch provider {
		case "zoomeye":
			return strings.TrimSpace(h.cfg.ZoomEye.APIKey)
		case "quake":
			return strings.TrimSpace(h.cfg.Quake.APIKey)
		case "shodan":
			return strings.TrimSpace(h.cfg.Shodan.APIKey)
		default:
			return strings.TrimSpace(h.cfg.FOFA.APIKey)
		}
	}
	return ""
}

func (h *FofaHandler) resolveBaseURL(provider string) string {
	provider = normalizeSpaceSearchProvider(provider)
	if h.cfg != nil {
		switch provider {
		case "zoomeye":
			if v := strings.TrimSpace(h.cfg.ZoomEye.BaseURL); v != "" {
				return canonicalizeSpaceSearchBaseURL(provider, v)
			}
		case "quake":
			if v := strings.TrimSpace(h.cfg.Quake.BaseURL); v != "" {
				return canonicalizeSpaceSearchBaseURL(provider, v)
			}
		case "shodan":
			if v := strings.TrimSpace(h.cfg.Shodan.BaseURL); v != "" {
				return canonicalizeSpaceSearchBaseURL(provider, v)
			}
		default:
			if v := strings.TrimSpace(h.cfg.FOFA.BaseURL); v != "" {
				return v
			}
		}
	}
	switch provider {
	case "zoomeye":
		return "https://api.zoomeye.ai/v2/search"
	case "quake":
		return "https://quake.360.net/api/v3/search/quake_service"
	case "shodan":
		return "https://api.shodan.io"
	default:
		return "https://fofa.info/api/v1/search/all"
	}
}

func canonicalizeSpaceSearchBaseURL(provider, raw string) string {
	v := strings.TrimSpace(raw)
	if v == "" {
		return v
	}
	switch normalizeSpaceSearchProvider(provider) {
	case "zoomeye":
		v = strings.Replace(v, "://api.zoomeye.org", "://api.zoomeye.ai", 1)
	case "quake":
		v = strings.Replace(v, "://quake.360.cn", "://quake.360.net", 1)
	}
	return v
}

// ParseNaturalLanguage parses natural language into FOFA query syntax (generation only; does not execute the query)
func (h *FofaHandler) ParseNaturalLanguage(c *gin.Context) {
	var req fofaParseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request parameters: " + err.Error()})
		return
	}
	req.Text = strings.TrimSpace(req.Text)
	provider := normalizeSpaceSearchProvider(req.Provider)
	if provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported provider, options: fofa, zoomeye, quake, shodan"})
		return
	}
	if req.Text == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "text is required"})
		return
	}

	if h.cfg == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "System configuration is not initialized"})
		return
	}
	if strings.TrimSpace(h.cfg.OpenAI.APIKey) == "" || strings.TrimSpace(h.cfg.OpenAI.Model) == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "AI model is not configured: please set openai.api_key and openai.model in system settings (OpenAI-compatible APIs such as DeepSeek are supported)",
			"need":  []string{"openai.api_key", "openai.model"},
		})
		return
	}
	if h.openAIClient == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI client is not initialized"})
		return
	}

	engineName := providerDisplayName(provider)
	syntaxNotes := map[string]string{
		"fofa": `
FOFA official query syntax reference:
- Basic format: field="value". String values use ASCII double quotes; join multiple conditions with && (and), || (or), ! (not).
- Precedence: complex expressions must use () to make precedence explicit, for example: (app="Apache" || app="nginx") && country="CN".
- Common fields: app, title, body, header, host, domain, ip, port, protocol, country, province, city, server, icp, cert, icon_hash, fid.
- Field examples:
  - app="Apache"
  - title="admin console"
  - body="Powered by"
  - header="JSESSIONID"
  - domain="example.com"
  - host="https://example.com"
  - ip="1.1.1.1"
  - port="443"
  - country="CN"
  - city="Hangzhou"
  - cert="example.com"
  - icon_hash="-247388890"
- Combination examples:
  - app="Apache" && country="CN"
  - title="login" || title="sign in"
  - (app="Apache" || app="nginx") && port="443"
  - domain="example.com" && !title="404"
  - cert="example.com" && port="443"
  - header="JSESSIONID" && country="CN"
- Generation notes:
  - When the user says "exclude/not/non", prefer !field="value".
  - Map "title contains/page title" to title; "body contains/page contains" to body; "response header/cookie/header" to header.
  - In FOFA, ports are usually written as port="443".
`,
		"zoomeye": `
ZoomEye query syntax reference:
- Basic format: field="value" or field=value; strings/phrases should use ASCII double quotes.
- Logical operators: && / || / ! may be used, as may AND / OR / NOT; use () in complex expressions to make precedence explicit.
- Common fields: app, service, title, domain, hostname, ip, port, country, city, org, isp, asn, cidr, ssl, ssl.cert.fingerprint, iconhash.
- Field examples:
  - app="Apache"
  - service="ssh"
  - title="login"
  - domain="example.com"
  - hostname="example.com"
  - ip="1.1.1.1"
  - cidr="1.1.1.0/24"
  - port=443
  - country="CN"
  - city="Beijing"
  - org="Tencent"
  - ssl="example.com"
  - ssl.cert.fingerprint="F3C98F223D82CC41CF83D94671CCC6C69873FABF"
  - iconhash="-247388890"
- Combination examples:
  - app="nginx" && country="CN"
  - service="http" && (title="login" || title="sign in")
  - domain="example.com" && !app="cloudflare"
  - port=443 && country="US"
  - app="Elasticsearch" && port=9200
- Generation notes:
  - When the user says "the service/protocol is SSH, HTTP, RDP", prefer mapping to service.
  - Map "site/website title" to title; "domain/root domain" preferably to domain or hostname.
  - Ports do not need quotes, for example port=443; if the user's original text already gives a colon-style expression close to ZoomEye syntax, it may be kept as is.
`,
		"quake": `
Quake query syntax reference:
- Basic format: field:"value" or field:value; strings/Chinese text/phrases use ASCII double quotes.
- Logical operators: use AND, OR, NOT; complex expressions must use () to make precedence explicit.
- Common fields: domain, ip, port, service.name, service.http.title, service.http.server, service.http.response.header, service.http.favicon.hash, country_cn, province_cn, city_cn, location.country_cn, location.province_cn, location.city_cn, asn, org.
- Field examples:
  - domain:"example.com"
  - ip:"1.1.1.1"
  - port:443
  - service.name:"http"
  - service.name:"ssh"
  - service.http.title:"login"
  - service.http.server:"nginx"
  - service.http.response.header:"JSESSIONID"
  - service.http.favicon.hash:"-247388890"
  - country:"Japan"
  - province:"Tokyo"
  - city:"Tokyo"
- Combination examples:
  - service.name:"http" AND country:"Japan"
  - (service.name:"http" OR service.name:"https") AND port:443
  - domain:"example.com" AND NOT service.http.title:"404"
  - service.http.title:"login" AND port:443
  - service.name:"ssh" AND country:"Japan"
- Generation notes:
  - When the user gives geographic locations such as Japan/Tokyo, Quake should prefer country/province/city with English values (as in the examples above).
  - Map "title" to service.http.title; "Server/server software" to service.http.server; "favicon/hash/icon" to service.http.favicon.hash.
  - Quake does not use && / || as the preferred output; prefer AND / OR / NOT.
`,
		"shodan": `
Shodan official query syntax reference:
- By default, a bare keyword only searches the banner data content; use filter:value for exact conditions.
- There must be no space between a filter and its value; if the value contains spaces, use ASCII double quotes, for example org:"Amazon Web Services".
- Multiple filters listed together must all match (AND); do not use && or || in Shodan queries unless the user explicitly provides them and asks to keep them.
- Common filters: product, port, country, city, org, asn, hostname, net, ssl, ssl.cert.subject.cn, http.title, has_screenshot, vuln.
- Field examples:
  - product:nginx
  - port:443
  - country:CN
  - city:Shanghai
  - org:"Amazon"
  - asn:AS15169
  - hostname:example.com
  - ssl.cert.subject.cn:example.com
  - http.title:"Dashboard"
  - has_screenshot:true
  - vuln:CVE-2021-41773
- Combination examples:
  - product:nginx country:CN
  - apache country:DE
  - org:"Amazon" port:443
  - ssl.cert.subject.cn:example.com port:443
  - http.title:"login" country:CN
  - ssl:true port:443 hostname:example.com
- Generation notes:
  - When the user says "product/component/service software", prefer mapping to product; "organization/company/cloud vendor" to org; "certificate CN/SAN/domain certificate" preferably to ssl.cert.subject.cn.
  - Use two-letter country codes for countries; if the user gives a Chinese country name and the code cannot be determined, write the inference in explanation or warnings.
  - Shodan has no general NOT exclusion syntax; for "exclude/not", state in warnings that manual adjustment may be needed, and do not invent filters.
`,
	}[provider]

	systemPrompt := strings.TrimSpace(fmt.Sprintf(`
You are the "%s query syntax generator". Task: convert the user's natural-language search intent into %s query syntax.

Output requirements (very important):
1) Output JSON only (no markdown, no code blocks, no extra explanatory text)
2) The JSON structure must be:
{
  "query": "string, the %s query syntax (can be pasted directly into %s or this system's query box)",
  "explanation": "string, optional, explains how you mapped fields/logic",
  "warnings": ["string"...] optional, lists ambiguities/risks/points that need manual confirmation
}
3) If the user's input is already %s query syntax (or an expression very close to that syntax), you should return it "as is" as query:
   - Do not rewrite field names, operators, or parenthesis structure on your own
   - Do not rewrite any string values (especially geographic location values); do not abbreviate, substitute synonyms, translate, or transliterate

Quick reference for the current search engine syntax:
%s

General generation constraints:
- Strictly follow the field names, operators, and example style in the "quick reference for the current search engine syntax"; different data sources have different syntax, so do not mix them.
- Keep string values as the user intended: do not abbreviate, translate, transliterate, substitute synonyms, or change case without basis.
- Entity values such as geographic locations, organization names, product names, domains, certificate names, and CVE IDs must be kept as originally written as far as possible; when an inference is truly needed (such as "China" to CN), state it in explanation or warnings.
- Do not invent fields. When unsure whether a field is supported, choose a more general and certain field, or write the uncertainty into warnings.
- When the description contains multiple and/or conditions, you must use the parentheses and logical operators supported by that data source to make precedence explicit.
- If the user's input is already the current data source's query syntax or very close to it, return it as is; only make minor corrections when there is an obvious syntax error and the fix is certain, and state it in explanation.
- If the request is too broad, a key target is missing, or the meaning is contradictory, query may be an empty string, and warnings must clearly state what information needs to be added.
- Only generate asset mapping / information gathering query syntax; do not generate scanning, exploitation, brute-forcing, bypass, command execution, or attack steps.
`, engineName, engineName, engineName, engineName, engineName, syntaxNotes))

	userPrompt := fmt.Sprintf("Natural-language intent: %s", req.Text)

	requestBody := map[string]interface{}{
		"model": h.cfg.OpenAI.Model,
		"messages": []map[string]interface{}{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
		"temperature":           0.1,
		"max_completion_tokens": 12000,
	}

	// OpenAI response structure: only choices[0].message.content is needed
	var apiResponse struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
	defer cancel()

	if err := h.openAIClient.ChatCompletion(ctx, requestBody, &apiResponse); err != nil {
		var apiErr *openaiClient.APIError
		if errors.As(err, &apiErr) {
			h.logger.Warn("FOFA natural-language parsing: LLM returned an error", zap.Int("status", apiErr.StatusCode))
			c.JSON(http.StatusBadGateway, gin.H{"error": "AI parsing failed (upstream returned non-200), please check the model configuration or try again later"})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "AI parsing failed: " + err.Error()})
		return
	}
	if len(apiResponse.Choices) == 0 {
		c.JSON(http.StatusBadGateway, gin.H{"error": "AI returned no valid result"})
		return
	}

	content := strings.TrimSpace(apiResponse.Choices[0].Message.Content)
	jsonContent, extractErr := extractInfoCollectJSONObject(content)
	if extractErr != nil {
		snippet := trimSnippet(content, 1200)
		c.JSON(http.StatusBadGateway, gin.H{
			"error":   "AI response could not be parsed as JSON. Try again later or rephrase your description",
			"snippet": snippet,
		})
		return
	}

	var parsed fofaParseResponse
	if err := json.Unmarshal([]byte(jsonContent), &parsed); err != nil {
		// Pass back part of the raw text directly for troubleshooting, but avoid making it too large
		snippet := trimSnippet(content, 1200)
		c.JSON(http.StatusBadGateway, gin.H{
			"error":   "AI response could not be parsed as JSON. Try again later or rephrase your description",
			"snippet": snippet,
		})
		return
	}
	parsed.Query = strings.TrimSpace(parsed.Query)
	if parsed.Query == "" {
		// query may be empty (meaning the requirement is unclear), but the frontend needs to show a clear prompt
		if len(parsed.Warnings) == 0 {
			parsed.Warnings = []string{"Not enough information to generate a usable " + engineName + " query syntax. Add key conditions (e.g. country/port/product/domain)."}
		}
	}

	c.JSON(http.StatusOK, parsed)
}

func extractInfoCollectJSONObject(content string) (string, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return "", errors.New("empty content")
	}
	candidates := []string{content}
	if fenced := extractFencedJSON(content); fenced != "" {
		candidates = append([]string{fenced}, candidates...)
	}
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if json.Valid([]byte(candidate)) {
			return candidate, nil
		}
		if obj := scanBalancedJSONObject(candidate); obj != "" && json.Valid([]byte(obj)) {
			return obj, nil
		}
	}
	return "", errors.New("json object not found")
}

func extractFencedJSON(content string) string {
	start := strings.Index(content, "```")
	if start < 0 {
		return ""
	}
	rest := content[start+3:]
	if nl := strings.Index(rest, "\n"); nl >= 0 {
		lang := strings.ToLower(strings.TrimSpace(rest[:nl]))
		if lang == "" || lang == "json" || strings.HasPrefix(lang, "json ") {
			rest = rest[nl+1:]
		}
	}
	end := strings.Index(rest, "```")
	if end < 0 {
		return ""
	}
	return strings.TrimSpace(rest[:end])
}

func scanBalancedJSONObject(content string) string {
	start := strings.Index(content, "{")
	if start < 0 {
		return ""
	}
	depth := 0
	inString := false
	escaped := false
	for i := start; i < len(content); i++ {
		ch := content[i]
		if inString {
			if escaped {
				escaped = false
				continue
			}
			switch ch {
			case '\\':
				escaped = true
			case '"':
				inString = false
			}
			continue
		}
		switch ch {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return strings.TrimSpace(content[start : i+1])
			}
		}
	}
	return ""
}

func trimSnippet(s string, maxRunes int) string {
	s = strings.TrimSpace(s)
	if maxRunes <= 0 {
		return ""
	}
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes])
}

// Search FOFA query (backend proxy, to avoid exposing the key to the frontend)
func (h *FofaHandler) Search(c *gin.Context) {
	var req fofaSearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request parameters: " + err.Error()})
		return
	}
	provider := normalizeSpaceSearchProvider(req.Provider)
	if provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported provider, options: fofa, zoomeye, quake, shodan"})
		return
	}

	req.Query = strings.TrimSpace(req.Query)
	if req.Query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "query is required"})
		return
	}
	if req.Size <= 0 {
		req.Size = 100
	}
	if req.Page <= 0 {
		req.Page = 1
	}
	// The FOFA API size limit depends on account permissions; here we only apply a reasonable safeguard
	if req.Size > 10000 {
		req.Size = 10000
	}
	if strings.TrimSpace(req.Fields) == "" {
		req.Fields = defaultFieldsForProvider(provider)
	}

	if provider != "fofa" {
		h.searchExternalProvider(c, provider, req)
		return
	}

	req.Fields = normalizeFofaFields(req.Fields)

	apiKey := h.resolveAPIKey(provider)
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "FOFA is not configured: enter the FOFA API Key under Asset Management in system settings, or set the FOFA_API_KEY environment variable",
			"need":    []string{"fofa.api_key"},
			"env_key": []string{"FOFA_API_KEY"},
		})
		return
	}

	baseURL := h.resolveBaseURL(provider)
	qb64 := base64.StdEncoding.EncodeToString([]byte(req.Query))

	u, err := url.Parse(baseURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "FOFA base_url is invalid: " + err.Error()})
		return
	}

	params := u.Query()
	params.Set("key", apiKey)
	params.Set("qbase64", qb64)
	params.Set("size", fmt.Sprintf("%d", req.Size))
	params.Set("page", fmt.Sprintf("%d", req.Page))
	params.Set("fields", strings.TrimSpace(req.Fields))
	if req.Full {
		params.Set("full", "true")
	} else {
		// Explicitly pass false, for troubleshooting
		params.Set("full", "false")
	}
	u.RawQuery = params.Encode()

	httpReq, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, u.String(), nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create request: " + err.Error()})
		return
	}
	httpReq.Header.Set("User-Agent", "CyberStrikeAI/1.7.4")
	httpReq.Header.Set("Accept", "application/json")

	resp, err := h.client.Do(httpReq)
	if err != nil {
		status, message, timeout := safeFofaRequestError(err)
		h.logger.Warn("Request to FOFA failed",
			zap.String("host", u.Host),
			zap.Bool("timeout", timeout),
			zap.String("error_type", fmt.Sprintf("%T", err)),
		)
		c.JSON(status, gin.H{"error": message})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("FOFA returned a non-2xx status: %d", resp.StatusCode)})
		return
	}

	var apiResp fofaAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResp); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to parse FOFA response: " + err.Error()})
		return
	}
	if apiResp.Error {
		msg := strings.TrimSpace(apiResp.ErrMsg)
		if msg == "" {
			msg = "FOFA returned an error"
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": msg})
		return
	}

	fields := splitAndCleanCSV(req.Fields)
	results := make([]map[string]interface{}, 0, len(apiResp.Results))
	for _, row := range apiResp.Results {
		item := make(map[string]interface{}, len(fields))
		for i, f := range fields {
			if i < len(row) {
				item[f] = row[i]
			} else {
				item[f] = nil
			}
		}
		results = append(results, item)
	}

	c.JSON(http.StatusOK, fofaSearchResponse{
		Provider:     provider,
		Query:        req.Query,
		Size:         apiResp.Size,
		Page:         apiResp.Page,
		Total:        apiResp.Total,
		Fields:       fields,
		ResultsCount: len(results),
		Results:      results,
	})
}

func (h *FofaHandler) searchExternalProvider(c *gin.Context, provider string, req fofaSearchRequest) {
	apiKey := h.resolveAPIKey(provider)
	if apiKey == "" {
		envKey := map[string]string{
			"zoomeye": "ZOOMEYE_API_KEY",
			"quake":   "QUAKE_API_KEY",
			"shodan":  "SHODAN_API_KEY",
		}[provider]
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   providerDisplayName(provider) + " is not configured: set api_key in config.yaml, or set the environment variable " + envKey,
			"need":    []string{provider + ".api_key"},
			"env_key": []string{envKey},
		})
		return
	}

	switch provider {
	case "zoomeye":
		h.searchZoomEye(c, req, apiKey)
	case "quake":
		h.searchQuake(c, req, apiKey)
	case "shodan":
		h.searchShodan(c, req, apiKey)
	}
}

func (h *FofaHandler) searchZoomEye(c *gin.Context, req fofaSearchRequest, apiKey string) {
	baseURL := h.resolveBaseURL("zoomeye")
	u, err := url.Parse(baseURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ZoomEye base_url is invalid: " + err.Error()})
		return
	}
	body := map[string]interface{}{
		"qbase64":  base64.StdEncoding.EncodeToString([]byte(req.Query)),
		"page":     req.Page,
		"pagesize": req.Size,
	}
	if fields := strings.TrimSpace(req.Fields); fields != "" {
		body["fields"] = fields
	}
	var apiResp spaceSearchEnvelope
	if !h.doJSONRequest(c, http.MethodPost, u.String(), apiKey, "API-KEY", body, &apiResp, "ZoomEye") {
		return
	}
	rows, err := decodeSpaceSearchRows(apiResp.Data)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to parse ZoomEye response: " + err.Error()})
		return
	}
	if zoomEyeRequestFailed(apiResp.Code, apiResp.Message) {
		msg := firstNonEmptySpaceSearchValue(apiResp.Message, messageFromRawObject(apiResp.Data), "ZoomEye returned an error")
		c.JSON(http.StatusBadGateway, gin.H{"error": msg})
		return
	}
	fields := splitAndCleanCSV(req.Fields)
	c.JSON(http.StatusOK, fofaSearchResponse{
		Provider:     "zoomeye",
		Query:        firstNonEmptySpaceSearchValue(apiResp.Query, req.Query),
		Size:         firstPositive(apiResp.PageSize, req.Size),
		Page:         firstPositive(apiResp.Page, req.Page),
		Total:        apiResp.Total,
		Fields:       fields,
		ResultsCount: len(rows),
		Results:      projectRows(rows, fields),
	})
}

func (h *FofaHandler) searchQuake(c *gin.Context, req fofaSearchRequest, apiKey string) {
	baseURL := h.resolveBaseURL("quake")
	u, err := url.Parse(baseURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Quake base_url is invalid: " + err.Error()})
		return
	}
	fields := splitAndCleanCSV(req.Fields)
	body := map[string]interface{}{
		"query":  req.Query,
		"size":   req.Size,
		"start":  (req.Page - 1) * req.Size,
		"latest": req.Full,
	}
	if len(fields) > 0 {
		body["include"] = fields
	}
	var apiResp spaceSearchEnvelope
	if !h.doJSONRequest(c, http.MethodPost, u.String(), apiKey, "X-QuakeToken", body, &apiResp, "Quake") {
		return
	}
	rows, err := decodeSpaceSearchRows(apiResp.Data)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to parse Quake response: " + err.Error()})
		return
	}
	if !isZeroSpaceSearchCode(apiResp.Code) {
		msg := firstNonEmptySpaceSearchValue(apiResp.Message, messageFromRawObject(apiResp.Data), "Quake returned an error")
		c.JSON(http.StatusBadGateway, gin.H{"error": msg})
		return
	}
	total := firstPositive(apiResp.TotalCount, apiResp.Meta.Pagination.Total)
	c.JSON(http.StatusOK, fofaSearchResponse{
		Provider:     "quake",
		Query:        req.Query,
		Size:         req.Size,
		Page:         req.Page,
		Total:        total,
		Fields:       fields,
		ResultsCount: len(rows),
		Results:      projectRows(rows, fields),
	})
}

func isZeroSpaceSearchCode(code interface{}) bool {
	switch v := code.(type) {
	case nil:
		return false
	case int:
		return v == 0
	case int64:
		return v == 0
	case float64:
		return v == 0
	case json.Number:
		n, err := v.Int64()
		return err == nil && n == 0
	case string:
		return strings.TrimSpace(v) == "0"
	default:
		return false
	}
}

func isZoomEyeSuccessCode(code interface{}) bool {
	switch v := code.(type) {
	case int:
		return v == 60000
	case int64:
		return v == 60000
	case float64:
		return v == 60000
	case json.Number:
		n, err := v.Int64()
		return err == nil && n == 60000
	case string:
		return strings.TrimSpace(v) == "60000"
	default:
		return false
	}
}

func zoomEyeRequestFailed(code interface{}, message string) bool {
	if isZoomEyeSuccessCode(code) {
		return false
	}
	msg := strings.ToLower(strings.TrimSpace(message))
	if code == nil || isZeroSpaceSearchCode(code) {
		return msg != "" && msg != "success" && msg != "ok" && msg != "successful."
	}
	return true
}

func decodeSpaceSearchRows(raw json.RawMessage) ([]map[string]interface{}, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return nil, nil
	}
	switch raw[0] {
	case '[':
		var rows []map[string]interface{}
		if err := json.Unmarshal(raw, &rows); err != nil {
			return nil, err
		}
		if rows == nil {
			return []map[string]interface{}{}, nil
		}
		return rows, nil
	case '{':
		var obj map[string]interface{}
		if err := json.Unmarshal(raw, &obj); err != nil {
			return nil, err
		}
		if len(obj) == 0 {
			return []map[string]interface{}{}, nil
		}
		for _, key := range []string{"data", "items", "matches", "results", "list", "records"} {
			nested, ok := obj[key]
			if !ok {
				continue
			}
			switch rows := nested.(type) {
			case []map[string]interface{}:
				return rows, nil
			case []interface{}:
				return interfaceSliceToRowMaps(rows), nil
			}
		}
		return []map[string]interface{}{}, nil
	default:
		return nil, fmt.Errorf("unexpected JSON value")
	}
}

func interfaceSliceToRowMaps(items []interface{}) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		if row, ok := item.(map[string]interface{}); ok {
			out = append(out, row)
		}
	}
	return out
}

func messageFromRawObject(raw json.RawMessage) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || raw[0] != '{' {
		return ""
	}
	var obj map[string]interface{}
	if err := json.Unmarshal(raw, &obj); err != nil {
		return ""
	}
	for _, key := range []string{"message", "error", "errmsg", "msg"} {
		if s, ok := obj[key].(string); ok {
			if msg := strings.TrimSpace(s); msg != "" {
				return msg
			}
		}
	}
	return ""
}

func extractRemoteAPIError(body []byte, statusCode int, label string) string {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) > 0 && trimmed[0] == '{' {
		var obj map[string]interface{}
		if err := json.Unmarshal(trimmed, &obj); err == nil {
			for _, key := range []string{"error", "message", "errmsg", "msg"} {
				if s, ok := obj[key].(string); ok {
					if msg := strings.TrimSpace(s); msg != "" {
						return msg
					}
				}
			}
		}
	}
	if len(trimmed) > 0 && trimmed[0] == '<' {
		return fmt.Sprintf("%s returned a web page instead of JSON (HTTP %d); check the Base URL or whether the network is being intercepted", label, statusCode)
	}
	if statusCode < 200 || statusCode >= 300 {
		return fmt.Sprintf("%s returned non-2xx: %d", label, statusCode)
	}
	return ""
}

func (h *FofaHandler) searchShodan(c *gin.Context, req fofaSearchRequest, apiKey string) {
	baseURL := strings.TrimRight(h.resolveBaseURL("shodan"), "/") + "/shodan/host/search"
	u, err := url.Parse(baseURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Shodan base_url is invalid: " + err.Error()})
		return
	}

	var apiResp spaceSearchEnvelope
	targetSize := req.Size
	if targetSize <= 0 {
		targetSize = 100
	}
	if targetSize > 1000 {
		targetSize = 1000
	}
	page := req.Page
	matches := make([]map[string]interface{}, 0, targetSize)
	pagesNeeded := (targetSize + 99) / 100
	for i := 0; i < pagesNeeded; i++ {
		pageURL := *u
		params := pageURL.Query()
		params.Set("key", apiKey)
		params.Set("query", req.Query)
		params.Set("page", fmt.Sprintf("%d", page+i))
		params.Set("minify", "false")
		if fields := strings.TrimSpace(req.Fields); fields != "" {
			params.Set("fields", fields)
		}
		pageURL.RawQuery = params.Encode()
		apiResp = spaceSearchEnvelope{}
		if !h.doJSONRequest(c, http.MethodGet, pageURL.String(), "", "", nil, &apiResp, "Shodan") {
			return
		}
		if errMsg := firstNonEmptySpaceSearchValue(apiResp.Error, apiResp.Message); errMsg != "" {
			c.JSON(http.StatusBadGateway, gin.H{"error": errMsg})
			return
		}
		pageMatches, err := decodeSpaceSearchRows(apiResp.Matches)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to parse Shodan response: " + err.Error()})
			return
		}
		if len(pageMatches) == 0 {
			break
		}
		matches = append(matches, pageMatches...)
		if len(matches) >= targetSize {
			matches = matches[:targetSize]
			break
		}
	}
	fields := splitAndCleanCSV(req.Fields)
	expectedCount := shodanExpectedResultCount(apiResp.Total, page, targetSize)
	shortfall := expectedCount - len(matches)
	warning := ""
	if shortfall > 0 {
		warning = fmt.Sprintf("Shodan reported a total of %d, but this page actually returned only %d/%d detail records", apiResp.Total, len(matches), expectedCount)
	}
	c.JSON(http.StatusOK, fofaSearchResponse{
		Provider:      "shodan",
		Query:         req.Query,
		Size:          targetSize,
		Page:          page,
		Total:         apiResp.Total,
		Fields:        fields,
		ResultsCount:  len(matches),
		ExpectedCount: expectedCount,
		Shortfall:     max(0, shortfall),
		Warning:       warning,
		Results:       projectRows(matches, fields),
	})
}

func shodanExpectedResultCount(total, page, size int) int {
	if total <= 0 || size <= 0 {
		return 0
	}
	if page <= 0 {
		page = 1
	}
	startOffset := (page - 1) * 100
	remaining := total - startOffset
	if remaining <= 0 {
		return 0
	}
	if remaining < size {
		return remaining
	}
	return size
}

func (h *FofaHandler) doJSONRequest(c *gin.Context, method, endpoint, apiKey, headerName string, body interface{}, out interface{}, label string) bool {
	var reqBody *strings.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create request: " + err.Error()})
			return false
		}
		reqBody = strings.NewReader(string(b))
	} else {
		reqBody = strings.NewReader("")
	}
	httpReq, err := http.NewRequestWithContext(c.Request.Context(), method, endpoint, reqBody)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create request: " + err.Error()})
		return false
	}
	httpReq.Header.Set("User-Agent", "CyberStrikeAI/1.7.4")
	httpReq.Header.Set("Accept", "application/json")
	if body != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	if headerName != "" && apiKey != "" {
		httpReq.Header.Set(headerName, apiKey)
	}
	resp, err := h.client.Do(httpReq)
	if err != nil {
		status, message, timeout := safeFofaRequestError(err)
		h.logger.Warn("Cyberspace mapping search request failed",
			zap.String("provider", label),
			zap.Bool("timeout", timeout),
			zap.String("error_type", fmt.Sprintf("%T", err)),
		)
		c.JSON(status, gin.H{"error": strings.Replace(message, "FOFA", label, 1)})
		return false
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Reading " + label + " response failed: " + err.Error()})
		return false
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := extractRemoteAPIError(respBody, resp.StatusCode, label)
		c.JSON(http.StatusBadGateway, gin.H{"error": msg})
		return false
	}
	if err := json.Unmarshal(respBody, out); err != nil {
		if msg := extractRemoteAPIError(respBody, resp.StatusCode, label); strings.Contains(msg, "web page") {
			c.JSON(http.StatusBadGateway, gin.H{"error": msg})
			return false
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "Parsing " + label + " response failed: " + err.Error()})
		return false
	}
	return true
}

func safeFofaRequestError(err error) (status int, message string, timeout bool) {
	var netErr net.Error
	timeout = errors.Is(err, context.DeadlineExceeded) ||
		(errors.As(err, &netErr) && netErr.Timeout())
	if timeout {
		return http.StatusGatewayTimeout,
			"FOFA request timed out (60 seconds): retry later, or reduce the number of results and returned fields",
			true
	}
	return http.StatusBadGateway,
		"Cannot connect to the FOFA service; check the server network or proxy configuration",
		false
}

func splitAndCleanCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, p := range parts {
		v := strings.TrimSpace(p)
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}

func projectRows(rows []map[string]interface{}, fields []string) []map[string]interface{} {
	if len(fields) == 0 {
		return rows
	}
	out := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		item := make(map[string]interface{}, len(fields))
		for _, field := range fields {
			item[field] = valueByPath(row, field)
		}
		out = append(out, item)
	}
	return out
}

func valueByPath(row map[string]interface{}, path string) interface{} {
	if row == nil {
		return nil
	}
	if v, ok := row[path]; ok {
		return v
	}
	parts := strings.Split(path, ".")
	var current interface{} = row
	for _, part := range parts {
		m, ok := current.(map[string]interface{})
		if !ok {
			return nil
		}
		current, ok = m[part]
		if !ok {
			return nil
		}
	}
	return current
}

func firstPositive(values ...int) int {
	for _, v := range values {
		if v > 0 {
			return v
		}
	}
	return 0
}

func firstNonEmptySpaceSearchValue(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
