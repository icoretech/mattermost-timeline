package main

import (
	"encoding/json"
	"net/http"
)

type batchWebhookObjectPayload struct {
	Events []WebhookPayload `json:"events"`
}

func (p *Plugin) handleWebhookBatch(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	body, handlerErr := readWebhookBody(w, r, maxWebhookBatchBodyBytes)
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	credential, handlerErr := p.authenticateWebhookRequest(r, body, config)
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	payloads, handlerErr := decodeWebhookBatchPayload(body)
	if handlerErr != nil {
		http.Error(w, handlerErr.message, handlerErr.status)
		return
	}

	results := make([]BatchWebhookResult, 0, len(payloads))
	successes := 0
	for index, payload := range payloads {
		result := p.processWebhookBatchItem(r, payload, credential, index)
		if result.Error == "" {
			successes++
		}
		results = append(results, result)
	}

	status := http.StatusOK
	if successes != len(results) {
		status = http.StatusMultiStatus
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(BatchWebhookResponse{Results: results}); err != nil {
		p.API.LogError("Failed to encode batch webhook response", "error", err.Error())
	}
}

func decodeWebhookBatchPayload(body []byte) ([]WebhookPayload, *webhookHandlerError) {
	var payloads []WebhookPayload
	if err := json.Unmarshal(body, &payloads); err == nil {
		return validateWebhookBatchPayloads(payloads)
	}

	var objectPayload batchWebhookObjectPayload
	if err := json.Unmarshal(body, &objectPayload); err != nil {
		return nil, &webhookHandlerError{message: "Invalid JSON payload", status: http.StatusBadRequest}
	}
	return validateWebhookBatchPayloads(objectPayload.Events)
}

func validateWebhookBatchPayloads(payloads []WebhookPayload) ([]WebhookPayload, *webhookHandlerError) {
	if len(payloads) == 0 {
		return nil, &webhookHandlerError{message: "events cannot be empty", status: http.StatusBadRequest}
	}
	if len(payloads) > maxWebhookBatchEvents {
		return nil, &webhookHandlerError{message: "Maximum 50 events per batch", status: http.StatusBadRequest}
	}
	return payloads, nil
}

func (p *Plugin) processWebhookBatchItem(r *http.Request, payload WebhookPayload, credential webhookCredential, index int) BatchWebhookResult {
	validated, handlerErr := p.validateWebhookPayloadForRequest(r, payload, credential)
	if handlerErr != nil {
		return BatchWebhookResult{Index: index, Status: handlerErr.status, Error: handlerErr.message}
	}

	stored, handlerErr := p.storeWebhookEvent(validated)
	if handlerErr != nil {
		return BatchWebhookResult{Index: index, Status: handlerErr.status, Error: handlerErr.message}
	}

	clientEvent, handlerErr := p.publishTimelineEventResponse(stored.eventName, stored.event)
	if handlerErr != nil {
		return BatchWebhookResult{Index: index, Status: handlerErr.status, Error: handlerErr.message}
	}
	return BatchWebhookResult{Index: index, Status: stored.status, Event: &clientEvent}
}
