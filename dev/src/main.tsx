import React, {useState, useCallback, useRef, useEffect} from 'react';
import {createRoot} from 'react-dom/client';

import TimelineEntry from '../../webapp/src/components/timeline_entry';
import '../../webapp/src/styles/timeline.scss';
import {FAKE_EVENTS, generateRandomEvent} from './fake-data';
import type {EventEntry, EventLink} from '../../webapp/src/types';

type TimelineOrder = 'oldest_first' | 'newest_first';

let updateCounter = 0;
const EXTRA_LINKS: EventLink[] = [
    {url: 'https://grafana.example.com/d/abc', label: 'Grafana'},
    {url: 'https://sentry.example.com/issues/456', label: 'Sentry'},
    {url: 'https://jira.example.com/browse/OPS-789', label: 'Jira'},
    {url: 'https://slack.example.com/archives/C123', label: 'Slack Thread'},
    {url: 'https://datadog.example.com/apm/trace/xyz', label: 'APM Trace'},
];

function DevApp() {
    const [events, setEvents] = useState<EventEntry[]>(FAKE_EVENTS);
    const [newEventIds, setNewEventIds] = useState<string[]>([]);
    const [updatedEventIds, setUpdatedEventIds] = useState<string[]>([]);
    const [timelineOrder, setTimelineOrder] = useState<TimelineOrder>('oldest_first');
    const [enableReactions, setEnableReactions] = useState(true);
    const listRef = useRef<HTMLDivElement>(null);

    const isOldestFirst = timelineOrder === 'oldest_first';
    const displayEvents = isOldestFirst ? [...events].reverse() : events;

    useEffect(() => {
        if (isOldestFirst && listRef.current && newEventIds.length > 0) {
            listRef.current.scrollTo({
                top: listRef.current.scrollHeight,
                behavior: 'smooth',
            });
        }
    }, [newEventIds.length, isOldestFirst]);

    useEffect(() => {
        if (isOldestFirst && listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [isOldestFirst]);

    // Scroll to updated event
    useEffect(() => {
        if (updatedEventIds.length > 0 && listRef.current) {
            if (isOldestFirst) {
                listRef.current.scrollTo({
                    top: listRef.current.scrollHeight,
                    behavior: 'smooth',
                });
            } else {
                listRef.current.scrollTo({
                    top: 0,
                    behavior: 'smooth',
                });
            }
        }
    }, [updatedEventIds.length, isOldestFirst]);

    const addRandomEvent = useCallback(() => {
        const event = generateRandomEvent();
        setEvents((prev) => [event, ...prev]);
        setNewEventIds((prev) => [...prev, event.id]);
    }, []);

    const addBurst = useCallback(() => {
        const burst = Array.from({length: 3}, () => generateRandomEvent());
        setEvents((prev) => [...burst.reverse(), ...prev]);
        setNewEventIds((prev) => [...prev, ...burst.map((e) => e.id)]);
    }, []);

    // Simulate external_id aggregation: pick a random event from the middle,
    // update its fields, append a new link, move it to front of the list
    const simulateUpdate = useCallback(() => {
        setEvents((prev) => {
            if (prev.length < 3) return prev;
            // Pick an event from the middle (not the most recent)
            const idx = Math.floor(prev.length / 2) + Math.floor(Math.random() * (prev.length / 3));
            const target = prev[Math.min(idx, prev.length - 1)];
            const extraLink = EXTRA_LINKS[updateCounter % EXTRA_LINKS.length];
            updateCounter++;

            // Aggregate links (dedup by URL)
            const existingLinks = target.links || [];
            const existingUrls = new Set(existingLinks.map((l) => l.url));
            const mergedLinks = existingUrls.has(extraLink.url)
                ? existingLinks
                : [...existingLinks, extraLink];

            const updated: EventEntry = {
                ...target,
                title: `[Updated] ${target.title.replace(/^\[Updated\] /, '')}`,
                message: `${target.message || ''} — updated with new info`.replace(/( — updated with new info)+/, ' — updated with new info'),
                timestamp: Date.now(),
                links: mergedLinks,
            };

            // Remove old position, put at front (most recent)
            const rest = prev.filter((e) => e.id !== target.id);
            return [updated, ...rest];
        });
        // We need the ID after state updates, so use a small trick
        setEvents((prev) => {
            if (prev.length > 0) {
                setUpdatedEventIds((u) => [...u, prev[0].id]);
            }
            return prev;
        });
    }, []);

    const clearAll = useCallback(() => {
        setEvents([]);
        setNewEventIds([]);
        setUpdatedEventIds([]);
    }, []);

    const resetData = useCallback(() => {
        setEvents(FAKE_EVENTS);
        setNewEventIds([]);
        setUpdatedEventIds([]);
    }, []);

    const handleAnimationEnd = useCallback((eventId: string) => {
        setNewEventIds((prev) => prev.filter((id) => id !== eventId));
    }, []);

    const handleUpdateAnimationEnd = useCallback((eventId: string) => {
        setUpdatedEventIds((prev) => prev.filter((id) => id !== eventId));
    }, []);

    const handleAddReaction = useCallback((eventId: string, icon: string) => {
        setEvents((prev) =>
            prev.map((ev) => {
                if (ev.id !== eventId) return ev;
                const reactions = {...(ev.client_reactions || {})};
                const existing = reactions[icon] || {count: 0, self: false, recent_users: []};
                reactions[icon] = {
                    count: existing.count + 1,
                    self: true,
                    recent_users: [...existing.recent_users, 'current-user'],
                };
                return {...ev, client_reactions: reactions};
            }),
        );
    }, []);

    const handleRemoveReaction = useCallback((eventId: string, icon: string) => {
        setEvents((prev) =>
            prev.map((ev) => {
                if (ev.id !== eventId) return ev;
                const reactions = {...(ev.client_reactions || {})};
                const existing = reactions[icon];
                if (!existing) return ev;
                const newCount = existing.count - 1;
                if (newCount <= 0) {
                    delete reactions[icon];
                } else {
                    reactions[icon] = {
                        count: newCount,
                        self: false,
                        recent_users: existing.recent_users.filter((u) => u !== 'current-user'),
                    };
                }
                return {
                    ...ev,
                    client_reactions: Object.keys(reactions).length > 0 ? reactions : undefined,
                };
            }),
        );
    }, []);

    const handleFetchReactionUsers = useCallback(
        (_eventId: string, _icon: string) => Promise.resolve([]),
        [],
    );

    const getUser = useCallback(
        (userId: string) => ({username: 'user', first_name: userId.slice(0, 4), last_name: ''}),
        [],
    );

    return (
        <div className='dev-rhs'>
            <div className='dev-controls'>
                <button className='primary' onClick={addRandomEvent}>
                    {'+ Add Event'}
                </button>
                <button onClick={addBurst}>
                    {'+ Burst (3)'}
                </button>
                <button className='update' onClick={simulateUpdate}>
                    {'⟳ Simulate Update'}
                </button>
                <button onClick={clearAll}>
                    {'Clear'}
                </button>
                <button onClick={resetData}>
                    {'Reset'}
                </button>
                <select
                    value={timelineOrder}
                    onChange={(e) => setTimelineOrder(e.target.value as TimelineOrder)}
                    style={{padding: '4px 8px', fontSize: '12px', borderRadius: '4px', border: '1px solid rgba(var(--center-channel-color-rgb), 0.16)', background: 'transparent', color: 'rgba(var(--center-channel-color-rgb), 0.72)', cursor: 'pointer'}}
                >
                    <option value='oldest_first'>{'Oldest first'}</option>
                    <option value='newest_first'>{'Newest first'}</option>
                </select>
                <button
                    onClick={() => setEnableReactions((prev) => !prev)}
                    style={{opacity: enableReactions ? 1 : 0.5}}
                >
                    {enableReactions ? 'Reactions ON' : 'Reactions OFF'}
                </button>
            </div>

            <div className='event-feed-timeline' style={{flex: 1, overflow: 'hidden'}}>
                <div className='event-feed-list' ref={listRef}>
                    {displayEvents.map((event) => (
                        <TimelineEntry
                            key={event.id}
                            event={event}
                            isNew={newEventIds.includes(event.id)}
                            isUpdated={updatedEventIds.includes(event.id)}
                            onAnimationEnd={handleAnimationEnd}
                            onUpdateAnimationEnd={handleUpdateAnimationEnd}
                            enableReactions={enableReactions}
                            onAddReaction={handleAddReaction}
                            onRemoveReaction={handleRemoveReaction}
                            onFetchReactionUsers={handleFetchReactionUsers}
                            getUser={getUser}
                        />
                    ))}
                    {events.length === 0 && (
                        <div className='event-feed-empty'>
                            <span className='event-feed-empty__icon'>{'📡'}</span>
                            <p>{'No events yet'}</p>
                            <p className='event-feed-empty__hint'>
                                {'Click "+ Add Event" to simulate incoming webhooks.'}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

const root = createRoot(document.getElementById('app')!);
root.render(<DevApp />);
