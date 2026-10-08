package main

import (
	"encoding/json"
	"net/http"
)

type adminErrorResponse struct {
	Code    string            `json:"code"`
	Params  map[string]string `json:"params,omitempty"`
	Message string            `json:"message"`
}

func (p *Plugin) writeAdminError(w http.ResponseWriter, handlerErr *webhookHandlerError) {
	code := handlerErr.Code
	if code == "" {
		code = "internal_error"
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(handlerErr.status)
	if err := json.NewEncoder(w).Encode(adminErrorResponse{
		Code: code, Params: handlerErr.Params, Message: handlerErr.message,
	}); err != nil {
		p.API.LogError("Failed to encode admin error response", "error", err.Error())
	}
}
