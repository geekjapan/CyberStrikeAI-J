package openai

// SSEAccumulatedKey is the field in the SSE progress event data that holds the server-authoritative full streaming text snapshot.
// The frontend should prefer this field to update its buffer, to avoid doubled characters caused by normalizing deltas a second time.
const SSEAccumulatedKey = "accumulated"

// WithSSEAccumulated attaches the current cumulative streaming full text (authoritative snapshot) to progress data.
func WithSSEAccumulated(data map[string]interface{}, accumulated string) map[string]interface{} {
	if data == nil {
		data = make(map[string]interface{}, 1)
	}
	data[SSEAccumulatedKey] = accumulated
	return data
}

// NormalizeStreamingDelta normalizes content that may be a "cumulative/resent fragment" into a "pure increment".
// Same as the unexported normalizeStreamingDelta; for use by packages such as agent and multiagent that accumulate body text before sending SSE.
func NormalizeStreamingDelta(current, incoming string) (next, delta string) {
	return normalizeStreamingDelta(current, incoming)
}
