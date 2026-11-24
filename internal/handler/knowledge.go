package handler

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"cyberstrike-ai/internal/audit"
	"cyberstrike-ai/internal/database"
	"cyberstrike-ai/internal/knowledge"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// KnowledgeHandler knowledge base handler
type KnowledgeHandler struct {
	manager   *knowledge.Manager
	retriever *knowledge.Retriever
	indexer   *knowledge.Indexer
	db        *database.DB
	logger    *zap.Logger
	audit     *audit.Service
}

// SetAudit wires platform audit logging.
func (h *KnowledgeHandler) SetAudit(s *audit.Service) {
	h.audit = s
}

// NewKnowledgeHandler creates a new knowledge base handler
func NewKnowledgeHandler(
	manager *knowledge.Manager,
	retriever *knowledge.Retriever,
	indexer *knowledge.Indexer,
	db *database.DB,
	logger *zap.Logger,
) *KnowledgeHandler {
	return &KnowledgeHandler{
		manager:   manager,
		retriever: retriever,
		indexer:   indexer,
		db:        db,
		logger:    logger,
	}
}

// GetCategories gets all categories
func (h *KnowledgeHandler) GetCategories(c *gin.Context) {
	categories, err := h.manager.GetCategories()
	if err != nil {
		h.logger.Error("Failed to get categories", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"categories": categories})
}

// GetItems gets the knowledge item list (supports pagination by category and keyword search; full content is not returned by default)
func (h *KnowledgeHandler) GetItems(c *gin.Context) {
	category := c.Query("category")
	searchKeyword := c.Query("search") // Search keyword

	// If a search keyword is provided, perform keyword search (across all data)
	if searchKeyword != "" {
		items, err := h.manager.SearchItemsByKeyword(searchKeyword, category)
		if err != nil {
			h.logger.Error("Failed to search knowledge items", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// Group the results by category
		groupedByCategory := make(map[string][]*knowledge.KnowledgeItemSummary)
		for _, item := range items {
			cat := item.Category
			if cat == "" {
				cat = "Uncategorized"
			}
			groupedByCategory[cat] = append(groupedByCategory[cat], item)
		}

		// Convert to CategoryWithItems format
		categoriesWithItems := make([]*knowledge.CategoryWithItems, 0, len(groupedByCategory))
		for cat, catItems := range groupedByCategory {
			categoriesWithItems = append(categoriesWithItems, &knowledge.CategoryWithItems{
				Category:  cat,
				ItemCount: len(catItems),
				Items:     catItems,
			})
		}

		// Sort by category name
		for i := 0; i < len(categoriesWithItems)-1; i++ {
			for j := i + 1; j < len(categoriesWithItems); j++ {
				if categoriesWithItems[i].Category > categoriesWithItems[j].Category {
					categoriesWithItems[i], categoriesWithItems[j] = categoriesWithItems[j], categoriesWithItems[i]
				}
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"categories": categoriesWithItems,
			"total":      len(categoriesWithItems),
			"search":     searchKeyword,
			"is_search":  true,
		})
		return
	}

	// Pagination mode: categoryPage=true means paginate by category, otherwise paginate by item (backward compatible)
	categoryPageMode := c.Query("categoryPage") != "false" // Use category pagination by default

	// Pagination parameters
	limit := 50 // Default 50 per page (number of categories when paginating by category, number of items when paginating by item)
	offset := 0
	if limitStr := c.Query("limit"); limitStr != "" {
		if parsed, err := parseInt(limitStr); err == nil && parsed > 0 && parsed <= 500 {
			limit = parsed
		}
	}
	if offsetStr := c.Query("offset"); offsetStr != "" {
		if parsed, err := parseInt(offsetStr); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	// If the category parameter is specified and category pagination mode is used, return only that category
	if category != "" && categoryPageMode {
		// Single-category mode: return all knowledge items of that category (not paginated)
		items, total, err := h.manager.GetItemsSummary(category, 0, 0)
		if err != nil {
			h.logger.Error("Failed to get knowledge items", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// Wrap into the category structure
		categoriesWithItems := []*knowledge.CategoryWithItems{
			{
				Category:  category,
				ItemCount: total,
				Items:     items,
			},
		}

		c.JSON(http.StatusOK, gin.H{
			"categories": categoriesWithItems,
			"total":      1, // There is only one category
			"limit":      limit,
			"offset":     offset,
		})
		return
	}

	if categoryPageMode {
		// Category pagination mode (default)
		// limit means the number of categories per page; 5-10 categories is recommended
		if limit <= 0 || limit > 100 {
			limit = 10 // Default 10 categories per page
		}

		categoriesWithItems, totalCategories, err := h.manager.GetCategoriesWithItems(limit, offset)
		if err != nil {
			h.logger.Error("Failed to get knowledge items by category", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"categories": categoriesWithItems,
			"total":      totalCategories,
			"limit":      limit,
			"offset":     offset,
		})
		return
	}

	// Item pagination mode (backward compatible)
	// Whether to include full content (default false; returns only summaries)
	includeContent := c.Query("includeContent") == "true"

	if includeContent {
		// Return full content (backward compatible)
		items, err := h.manager.GetItemsWithOptions(category, limit, offset, true)
		if err != nil {
			h.logger.Error("Failed to get knowledge items", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		// Get the total count
		total, err := h.manager.GetItemsCount(category)
		if err != nil {
			h.logger.Warn("Failed to get total knowledge item count", zap.Error(err))
			total = len(items)
		}

		c.JSON(http.StatusOK, gin.H{
			"items":  items,
			"total":  total,
			"limit":  limit,
			"offset": offset,
		})
	} else {
		// Return summaries (no full content; the recommended approach)
		items, total, err := h.manager.GetItemsSummary(category, limit, offset)
		if err != nil {
			h.logger.Error("Failed to get knowledge items", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"items":  items,
			"total":  total,
			"limit":  limit,
			"offset": offset,
		})
	}
}

// GetItem gets a single knowledge item
func (h *KnowledgeHandler) GetItem(c *gin.Context) {
	id := c.Param("id")

	item, err := h.manager.GetItem(id)
	if err != nil {
		h.logger.Error("Failed to get knowledge items", zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, item)
}

// CreateItem creates a knowledge item
func (h *KnowledgeHandler) CreateItem(c *gin.Context) {
	var req struct {
		Category string `json:"category" binding:"required"`
		Title    string `json:"title" binding:"required"`
		Content  string `json:"content" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	item, err := h.manager.CreateItem(req.Category, req.Title, req.Content)
	if err != nil {
		h.logger.Error("Failed to create knowledge item", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Asynchronous indexing
	go func() {
		ctx := context.Background()
		if err := h.indexer.IndexItem(ctx, item.ID); err != nil {
			h.logger.Warn("Failed to index knowledge item", zap.String("itemId", item.ID), zap.Error(err))
		}
	}()

	c.JSON(http.StatusOK, item)
}

// UpdateItem updates a knowledge item
func (h *KnowledgeHandler) UpdateItem(c *gin.Context) {
	id := c.Param("id")

	var req struct {
		Category string `json:"category" binding:"required"`
		Title    string `json:"title" binding:"required"`
		Content  string `json:"content" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	item, err := h.manager.UpdateItem(id, req.Category, req.Title, req.Content)
	if err != nil {
		h.logger.Error("Failed to update knowledge item", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Asynchronous re-indexing
	go func() {
		ctx := context.Background()
		if err := h.indexer.IndexItem(ctx, item.ID); err != nil {
			h.logger.Warn("Failed to re-index knowledge item", zap.String("itemId", item.ID), zap.Error(err))
		}
	}()

	c.JSON(http.StatusOK, item)
}

// DeleteItem deletes a knowledge item
func (h *KnowledgeHandler) DeleteItem(c *gin.Context) {
	id := c.Param("id")

	if err := h.manager.DeleteItem(id); err != nil {
		h.logger.Error("Failed to delete knowledge item", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if h.audit != nil {
		h.audit.RecordOK(c, "knowledge", "item_delete", "Delete knowledge item", "knowledge_item", id, nil)
	}
	c.JSON(http.StatusOK, gin.H{"message": "Deleted successfully"})
}

// StartIndex builds the knowledge base vector index. By default it only fills in knowledge items that have no vectors yet; with mode=full it rebuilds everything.
func (h *KnowledgeHandler) StartIndex(c *gin.Context) {
	if err := h.indexer.TryBeginIndexRun(); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "An indexing task is already running. Please wait for it to finish"})
		return
	}

	mode := strings.TrimSpace(c.Query("mode"))
	if mode == "" {
		mode = "missing"
	}
	if mode != "full" && mode != "missing" {
		h.indexer.FinishIndexRun()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid mode parameter. Allowed values: missing, full"})
		return
	}

	fullRebuild := mode == "full"
	message := "Index build started and will run in the background"
	auditAction := "index_build"
	auditDetail := "Build knowledge base index"
	if fullRebuild {
		message = "Full index rebuild started and will run in the background"
		auditAction = "index_rebuild_full"
		auditDetail = "Full rebuild of knowledge base index"
	}

	go func() {
		defer h.indexer.FinishIndexRun()
		ctx := context.Background()
		var err error
		if fullRebuild {
			err = h.indexer.RunRebuildIndex(ctx)
		} else {
			err = h.indexer.RunIndexMissing(ctx)
		}
		if err != nil {
			if fullRebuild {
				h.logger.Error("Full index rebuild failed", zap.Error(err))
			} else {
				h.logger.Error("Failed to build knowledge base index", zap.Error(err))
			}
		}
	}()

	if h.audit != nil {
		h.audit.RecordOK(c, "knowledge", auditAction, auditDetail, "knowledge", "", nil)
	}
	c.JSON(http.StatusOK, gin.H{"message": message, "mode": mode})
}

// ScanKnowledgeBase scans the knowledge base
func (h *KnowledgeHandler) ScanKnowledgeBase(c *gin.Context) {
	itemsToIndex, err := h.manager.ScanKnowledgeBase()
	if err != nil {
		h.logger.Error("Failed to scan the knowledge base", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if len(itemsToIndex) == 0 {
		c.JSON(http.StatusOK, gin.H{"message": "Scan complete. No new or updated items need indexing"})
		return
	}

	// Asynchronously index newly added or updated items (incremental indexing)
	go func() {
		ctx := context.Background()
		h.logger.Info("Starting incremental indexing", zap.Int("count", len(itemsToIndex)))
		failedCount := 0
		consecutiveFailures := 0
		var firstFailureItemID string
		var firstFailureError error

		for i, itemID := range itemsToIndex {
			if err := h.indexer.IndexItem(ctx, itemID); err != nil {
				failedCount++
				consecutiveFailures++

				// Log detailed information only for the first failure
				if consecutiveFailures == 1 {
					firstFailureItemID = itemID
					firstFailureError = err
					h.logger.Warn("Failed to index knowledge item",
						zap.String("itemId", itemID),
						zap.Int("totalItems", len(itemsToIndex)),
						zap.Error(err),
					)
				}

				// If it fails 2 times in a row, stop incremental indexing immediately
				if consecutiveFailures >= 2 {
					h.logger.Error("Too many consecutive indexing failures, stopping incremental indexing immediately",
						zap.Int("consecutiveFailures", consecutiveFailures),
						zap.Int("totalItems", len(itemsToIndex)),
						zap.Int("processedItems", i+1),
						zap.String("firstFailureItemId", firstFailureItemID),
						zap.Error(firstFailureError),
					)
					break
				}
				continue
			}

			// Reset the consecutive failure count on success
			if consecutiveFailures > 0 {
				consecutiveFailures = 0
				firstFailureItemID = ""
				firstFailureError = nil
			}

			// Reduce the frequency of progress logs
			if (i+1)%10 == 0 || i+1 == len(itemsToIndex) {
				h.logger.Info("Indexing progress", zap.Int("current", i+1), zap.Int("total", len(itemsToIndex)), zap.Int("failed", failedCount))
			}
		}
		h.logger.Info("Incremental indexing complete", zap.Int("totalItems", len(itemsToIndex)), zap.Int("failedCount", failedCount))
	}()

	c.JSON(http.StatusOK, gin.H{
		"message":        fmt.Sprintf("Scan complete. Indexing %d newly added or updated knowledge items", len(itemsToIndex)),
		"items_to_index": len(itemsToIndex),
	})
}

// GetRetrievalLogs gets retrieval logs
func (h *KnowledgeHandler) GetRetrievalLogs(c *gin.Context) {
	conversationID := c.Query("conversationId")
	messageID := c.Query("messageId")
	limit := 50 // Default 50 entries

	if limitStr := c.Query("limit"); limitStr != "" {
		if parsed, err := parseInt(limitStr); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	logs, err := h.manager.GetRetrievalLogs(conversationID, messageID, limit)
	if err != nil {
		h.logger.Error("Failed to get retrieval logs", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"logs": logs})
}

// DeleteRetrievalLog deletes a retrieval log
func (h *KnowledgeHandler) DeleteRetrievalLog(c *gin.Context) {
	id := c.Param("id")

	if err := h.manager.DeleteRetrievalLog(id); err != nil {
		h.logger.Error("Failed to delete retrieval logs", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Deleted successfully"})
}

// GetIndexStatus gets the index status
func (h *KnowledgeHandler) GetIndexStatus(c *gin.Context) {
	status, err := h.manager.GetIndexStatus()
	if err != nil {
		h.logger.Error("Failed to get index status", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Get the indexer's error information
	if h.indexer != nil {
		lastError, lastErrorTime := h.indexer.GetLastError()
		// Keep a failed operation visible until the indexer clears it for the next run.
		appendKnowledgeIndexError(status, lastError, lastErrorTime)

		// Get the rebuild index status
		isRebuilding, totalItems, current, failed, lastItemID, lastChunks, startTime := h.indexer.GetRebuildStatus()
		if isRebuilding {
			status["is_rebuilding"] = true
			status["rebuild_total"] = totalItems
			status["rebuild_current"] = current
			status["rebuild_failed"] = failed
			status["rebuild_start_time"] = startTime.Format(time.RFC3339)
			if lastItemID != "" {
				status["rebuild_last_item_id"] = lastItemID
			}
			if lastChunks > 0 {
				status["rebuild_last_chunks"] = lastChunks
			}
			// While rebuilding, is_complete is false
			status["is_complete"] = false
			// Calculate the rebuild progress percentage
			if totalItems > 0 {
				status["progress_percent"] = float64(current) / float64(totalItems) * 100
			}
		}
	}

	c.JSON(http.StatusOK, status)
}

// Search searches the knowledge base (for API calls; the Agent internally uses Retriever)
func (h *KnowledgeHandler) Search(c *gin.Context) {
	var req knowledge.SearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Retriever.Search goes through the Agent VectorRetriever, consistent with the MCP tool chain.
	results, err := h.retriever.Search(c.Request.Context(), &req)
	if err != nil {
		h.logger.Error("Failed to search knowledge base", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"results": results})
}

// GetStats gets knowledge base statistics
func (h *KnowledgeHandler) GetStats(c *gin.Context) {
	totalCategories, totalItems, err := h.manager.GetStats()
	if err != nil {
		h.logger.Error("Failed to get knowledge base statistics", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"enabled":          true,
		"total_categories": totalCategories,
		"total_items":      totalItems,
	})
}

// Helper function: parse integer
func parseInt(s string) (int, error) {
	var result int
	_, err := fmt.Sscanf(s, "%d", &result)
	return result, err
}

func appendKnowledgeIndexError(status map[string]interface{}, message string, occurredAt time.Time) {
	if message == "" {
		return
	}
	status["last_error"] = message
	status["last_error_time"] = occurredAt.Format(time.RFC3339)
}
