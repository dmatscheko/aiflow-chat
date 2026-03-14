/**
 * @fileoverview Shared constants used across the application.
 * Centralizes localStorage keys, default IDs, and other magic strings
 * to prevent duplication and reduce the risk of typos.
 */

'use strict';

/**
 * Keys used for persisting data in localStorage.
 * @enum {string}
 */
export const STORAGE_KEYS = {
    ACTIVE_CHAT_ID: 'core_active_chat_id',
    LAST_ACTIVE_IDS: 'core_last_active_ids',
    AGENTS: 'core_agents',
    CHAT_LOGS: 'core_chat_logs',
    FLOWS: 'core_flows',
};

/**
 * The unique identifier for the mandatory Default Agent.
 * @const {string}
 */
export const DEFAULT_AGENT_ID = 'agent-default';
