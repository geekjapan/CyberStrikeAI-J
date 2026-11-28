package handler

// addAgentRunSpec reuses each synchronous request schema without changing it.
func addAgentRunSpec(spec map[string]interface{}) {
	paths := spec["paths"].(map[string]interface{})
	for _, base := range []string{"/api/agent", "/api/multi-agent"} {
		original := paths[base].(map[string]interface{})["post"].(map[string]interface{})
		paths[base+"/runs"] = map[string]interface{}{"post": map[string]interface{}{
			"tags": []string{"Conversation interaction"}, "summary": "Submit a conversation task asynchronously", "description": "Returns 202 once accepted; a client disconnect does not cancel the task. A per-user Idempotency-Key is required; the same key and request return the original receipt, a different request returns 409. Query the final result through statusUrl; cancel with /api/agent-loop/cancel.",
			"requestBody": original["requestBody"],
			"parameters":  []map[string]interface{}{{"in": "header", "name": "Idempotency-Key", "required": true, "schema": map[string]interface{}{"type": "string", "minLength": 1, "maxLength": 200}}},
			"responses":   map[string]interface{}{"202": map[string]interface{}{"description": "Accepted: runId, conversationId, assistantMessageId, status, statusUrl; Location is the query address"}, "400": map[string]interface{}{"description": "Invalid parameters or mode"}, "403": map[string]interface{}{"description": "No permission"}, "409": map[string]interface{}{"description": "Idempotency key payload conflict or the session is already running"}, "500": map[string]interface{}{"description": "Failed to record the accepted request"}},
		}}
		paths[base+"/runs/{runId}"] = map[string]interface{}{"get": map[string]interface{}{
			"tags": []string{"Conversation interaction"}, "summary": "Query an async conversation task", "description": "Returns the persisted status, result, session and message identifiers, and timestamps. Tasks unfinished after a service restart are marked interrupted and are not replayed automatically.",
			"parameters": []map[string]interface{}{{"in": "path", "name": "runId", "required": true, "schema": map[string]interface{}{"type": "string"}}},
			"responses":  map[string]interface{}{"200": map[string]interface{}{"description": "Task status and result"}, "403": map[string]interface{}{"description": "No permission to access the conversation"}, "404": map[string]interface{}{"description": "Task not found"}},
		}}
	}
}
