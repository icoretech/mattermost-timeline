package main

import (
	"testing"

	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/require"
)

func TestOnActivateInitializesRuntimeState(t *testing.T) {
	api := &plugintest.API{}
	p := &Plugin{}
	p.SetAPI(api)
	p.setConfiguration(&configuration{MaxEventsStored: "123"})

	require.NoError(t, p.OnActivate())
	require.NotNil(t, p.router)
	require.NotNil(t, p.store)
	require.Equal(t, 123, p.store.maxEventsLimit())
}
