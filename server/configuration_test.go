package main

import (
	"errors"
	"testing"

	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestOnConfigurationChange(t *testing.T) {
	t.Run("propagates load errors", func(t *testing.T) {
		api := &plugintest.API{}
		p := &Plugin{}
		p.API = api

		api.On("LoadPluginConfiguration", mock.AnythingOfType("*main.configuration")).
			Return(errors.New("boom"))

		err := p.OnConfigurationChange()
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to load plugin configuration")
		assert.Nil(t, p.configuration)
		api.AssertExpectations(t)
	})

	t.Run("stores loaded configuration", func(t *testing.T) {
		api := &plugintest.API{}
		p := &Plugin{}
		p.API = api

		api.On("LoadPluginConfiguration", mock.AnythingOfType("*main.configuration")).
			Return(func(dest interface{}) error {
				cfg := dest.(*configuration)
				cfg.WebhookSecret = "secret"
				cfg.MaxEventsStored = "42"
				cfg.MaxEventsDisplayed = "12"
				cfg.TimelineOrder = "newest_first"
				cfg.EnableReactions = true
				return nil
			})

		require.NoError(t, p.OnConfigurationChange())
		cfg := p.getConfiguration()
		assert.Equal(t, "secret", cfg.WebhookSecret)
		assert.Equal(t, 42, cfg.maxEventsStoredInt())
		assert.Equal(t, 12, cfg.maxEventsDisplayedInt())
		assert.Equal(t, TimelineOrderNewestFirst, cfg.timelineOrder())
		assert.True(t, cfg.enableReactions())
		api.AssertExpectations(t)
	})

	t.Run("updates existing store max events", func(t *testing.T) {
		api := &plugintest.API{}
		p := &Plugin{store: NewEventStore(api, 100)}
		p.API = api

		api.On("LoadPluginConfiguration", mock.AnythingOfType("*main.configuration")).
			Return(func(dest interface{}) error {
				dest.(*configuration).MaxEventsStored = "7"
				return nil
			})

		require.NoError(t, p.OnConfigurationChange())
		assert.Equal(t, 7, p.store.maxEventsLimit())
		api.AssertExpectations(t)
	})
}

func TestOnActivateUsesLoadedConfiguration(t *testing.T) {
	api := &plugintest.API{}
	p := &Plugin{}
	p.API = api

	api.On("LoadPluginConfiguration", mock.AnythingOfType("*main.configuration")).
		Return(func(dest interface{}) error {
			dest.(*configuration).MaxEventsStored = "11"
			return nil
		})

	require.NoError(t, p.OnConfigurationChange())
	require.NoError(t, p.OnActivate())
	require.NotNil(t, p.store)
	require.NotNil(t, p.router)
	assert.Equal(t, 11, p.store.maxEventsLimit())
	api.AssertExpectations(t)
}
