/**
 * @fileoverview Utility functions for chat management.
 */

'use strict';

import { log } from './logger.js';
import { Message } from '../components/chatlog.js';

/**
 * Generates a string with the current date and time prompt.
 * @returns {string} The formatted date and time prompt.
 */
export function getDatePrompt() {
    const now = new Date();
    return `\n\nKnowledge cutoff: none\nCurrent date: ${now.toISOString().slice(0, 10)}\nCurrent time: ${now.toTimeString().slice(0, 5)}`;
}
