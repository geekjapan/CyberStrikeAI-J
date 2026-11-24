package knowledge

import (
	"encoding/json"
	"time"
)

// formatTime formats time as RFC3339; a zero time returns an empty string
func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}

// KnowledgeItem knowledge base item
type KnowledgeItem struct {
	ID        string    `json:"id"`
	Category  string    `json:"category"` // Risk type (folder name)
	Title     string    `json:"title"`    // Title (file name)
	FilePath  string    `json:"filePath"` // File path
	Content   string    `json:"content"`  // File content
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// KnowledgeItemSummary knowledge base item summary (for lists; no full content)
type KnowledgeItemSummary struct {
	ID        string    `json:"id"`
	Category  string    `json:"category"`
	Title     string    `json:"title"`
	FilePath  string    `json:"filePath"`
	Content   string    `json:"content,omitempty"` // Optional: content preview (if provided, usually only the first 150 characters)
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// MarshalJSON custom JSON serialization, ensuring the time format is correct
func (k *KnowledgeItemSummary) MarshalJSON() ([]byte, error) {
	type Alias KnowledgeItemSummary
	aux := &struct {
		*Alias
		CreatedAt string `json:"createdAt"`
		UpdatedAt string `json:"updatedAt"`
	}{
		Alias: (*Alias)(k),
	}
	aux.CreatedAt = formatTime(k.CreatedAt)
	aux.UpdatedAt = formatTime(k.UpdatedAt)
	return json.Marshal(aux)
}

// MarshalJSON custom JSON serialization, ensuring the time format is correct
func (k *KnowledgeItem) MarshalJSON() ([]byte, error) {
	type Alias KnowledgeItem
	aux := &struct {
		*Alias
		CreatedAt string `json:"createdAt"`
		UpdatedAt string `json:"updatedAt"`
	}{
		Alias: (*Alias)(k),
	}
	aux.CreatedAt = formatTime(k.CreatedAt)
	aux.UpdatedAt = formatTime(k.UpdatedAt)
	return json.Marshal(aux)
}

// KnowledgeChunk knowledge chunk (for vectorization)
type KnowledgeChunk struct {
	ID         string    `json:"id"`
	ItemID     string    `json:"itemId"`
	ChunkIndex int       `json:"chunkIndex"`
	ChunkText  string    `json:"chunkText"`
	Embedding  []float32 `json:"-"` // Vector embedding; not serialized to JSON
	CreatedAt  time.Time `json:"createdAt"`
}

// RetrievalResult retrieval result
type RetrievalResult struct {
	Chunk      *KnowledgeChunk `json:"chunk"`
	Item       *KnowledgeItem  `json:"item"`
	Similarity float64         `json:"similarity"` // Similarity score
	Score      float64         `json:"score"`      // Same as Similarity: cosine similarity
}

// RetrievalLog retrieval log
type RetrievalLog struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversationId,omitempty"`
	MessageID      string    `json:"messageId,omitempty"`
	Query          string    `json:"query"`
	RiskType       string    `json:"riskType,omitempty"`
	RetrievedItems []string  `json:"retrievedItems"` // List of retrieved knowledge item IDs
	CreatedAt      time.Time `json:"createdAt"`
}

// MarshalJSON custom JSON serialization, ensuring the time format is correct
func (r *RetrievalLog) MarshalJSON() ([]byte, error) {
	type Alias RetrievalLog
	return json.Marshal(&struct {
		*Alias
		CreatedAt string `json:"createdAt"`
	}{
		Alias:     (*Alias)(r),
		CreatedAt: formatTime(r.CreatedAt),
	})
}

// CategoryWithItems is a category and the knowledge items under it (for pagination by category)
type CategoryWithItems struct {
	Category  string                  `json:"category"`  // Category name
	ItemCount int                     `json:"itemCount"` // Total number of knowledge items under this category
	Items     []*KnowledgeItemSummary `json:"items"`     // List of knowledge items under this category
}

// SearchRequest search request
type SearchRequest struct {
	Query          string  `json:"query"`
	RiskType       string  `json:"riskType,omitempty"`       // Optional: specify the risk type
	SubIndexFilter string  `json:"subIndexFilter,omitempty"` // Optional: keep only rows whose sub_indexes contain this tag (including old untagged data)
	TopK           int     `json:"topK,omitempty"`           // Return Top-K results, default 5
	Threshold      float64 `json:"threshold,omitempty"`      // Similarity threshold, default 0.7
}
