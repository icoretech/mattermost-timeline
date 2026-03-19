package main

import (
	"sync"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/plugin"
)

// Plugin implements the interface expected by the Mattermost server to communicate between the server and plugin processes.
type Plugin struct {
	plugin.MattermostPlugin

	router *mux.Router
	store  *EventStore

	configurationLock sync.RWMutex
	configuration     *configuration
}

func (p *Plugin) OnActivate() error {
	config := p.getConfiguration()
	p.store = NewEventStore(p.API, config.maxEventsStoredInt())
	p.router = p.initRouter()
	return nil
}
