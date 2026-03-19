package main

import (
	"fmt"
	"strconv"
)

type configuration struct {
	WebhookSecret      string `json:"WebhookSecret"`
	MaxEventsStored    string `json:"MaxEventsStored"`
	MaxEventsDisplayed string `json:"MaxEventsDisplayed"`
	TimelineOrder      string `json:"TimelineOrder"`
}

func (c *configuration) timelineOrder() string {
	if c.TimelineOrder == "newest_first" || c.TimelineOrder == "oldest_first" {
		return c.TimelineOrder
	}
	return "oldest_first"
}

func (c *configuration) Clone() *configuration {
	clone := *c
	return &clone
}

func (c *configuration) maxEventsStoredInt() int {
	n, err := strconv.Atoi(c.MaxEventsStored)
	if err != nil || n <= 0 {
		return 500
	}
	return n
}

func (c *configuration) maxEventsDisplayedInt() int {
	n, err := strconv.Atoi(c.MaxEventsDisplayed)
	if err != nil || n <= 0 {
		return 100
	}
	return n
}

func (p *Plugin) getConfiguration() *configuration {
	p.configurationLock.RLock()
	defer p.configurationLock.RUnlock()

	if p.configuration == nil {
		return &configuration{}
	}

	return p.configuration
}

func (p *Plugin) setConfiguration(configuration *configuration) {
	p.configurationLock.Lock()
	defer p.configurationLock.Unlock()

	if configuration != nil && p.configuration == configuration {
		panic("setConfiguration called with the existing configuration")
	}

	p.configuration = configuration
}

func (p *Plugin) OnConfigurationChange() error {
	configuration := new(configuration)

	if err := p.API.LoadPluginConfiguration(configuration); err != nil {
		return fmt.Errorf("failed to load plugin configuration: %w", err)
	}

	p.setConfiguration(configuration)

	if p.store != nil {
		p.store.SetMaxEvents(configuration.maxEventsStoredInt())
	}

	return nil
}
