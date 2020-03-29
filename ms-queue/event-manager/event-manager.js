"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var EventManager_1;
Object.defineProperty(exports, "__esModule", { value: true });
const debug_1 = __importDefault(require("debug"));
const inversify_1 = require("inversify");
const request_promise_1 = __importDefault(require("request-promise"));
const event_item_1 = require("./event-item");
exports.EventItem = event_item_1.EventItem;
const event_queue_1 = require("./event-queue");
const log = debug_1.default('ms-queue:EventManager');
let EventManager = EventManager_1 = class EventManager {
    constructor(eventQueue) {
        this.eventQueue = eventQueue;
    }
    get eventStats() {
        const priorityStats = JSON.parse(JSON.stringify(EventManager_1.DEFAULT_PRIORITIES));
        const queueNames = this.eventQueue.queueNames();
        queueNames.forEach((queueName) => {
            Object.values(this.eventQueue.eventIds(queueName)).forEach((priority) => {
                if (!priorityStats[queueName]) {
                    priorityStats[queueName] = { PRIORITY_TOTAL: 0 };
                }
                const statKey = `PRIORITY_${priority}`;
                EventManager_1.DEFAULT_PRIORITIES[statKey] = 0;
                if (!EventManager_1.DEFAULT_PRIORITIES[queueName]) {
                    EventManager_1.DEFAULT_PRIORITIES[queueName] = { PRIORITY_TOTAL: 0 };
                }
                EventManager_1.DEFAULT_PRIORITIES[queueName][statKey] = 0;
                priorityStats[queueName][statKey] = (priorityStats[queueName][statKey] || 0) + 1;
                priorityStats[queueName].PRIORITY_TOTAL += 1;
                priorityStats[statKey] = (priorityStats[statKey] || 0) + 1;
                priorityStats.PRIORITY_TOTAL += 1;
            });
        });
        return priorityStats;
    }
    get prometheus() {
        const unixTimeStamp = new Date().getTime();
        const prometheusRows = [];
        const priorityStats = this.eventStats;
        Object.keys(priorityStats).forEach((queueName) => {
            if (typeof priorityStats[queueName] === 'object') {
                Object.keys(priorityStats[queueName]).forEach((key) => {
                    prometheusRows.push(`${queueName}_queue_priority{label="${key}"} ${priorityStats[queueName][key]} ${unixTimeStamp}`);
                });
                return;
            }
            prometheusRows.push(`queue_priority{label="${queueName}"} ${priorityStats[queueName]} ${unixTimeStamp}`);
        });
        return `${prometheusRows.sort().join('\n')}\n`;
    }
    initialize(notifyNeedTaskURLS = []) {
        this.eventQueue.notifyNeedTaskURLS = notifyNeedTaskURLS;
    }
    comparatorFunction(queueName, value) {
        this.eventQueue.comparatorFunction(queueName, value);
    }
    add(queueName, eventItem) {
        if (this.eventQueue.isEventPresent(queueName, eventItem)) {
            return;
        }
        this.eventQueue.add(queueName, eventItem);
    }
    poll(queueName) {
        if (!this.eventQueue.size(queueName)) {
            this.notifyTaskNeeded(queueName)
                .catch((error) => log(error));
            return undefined;
        }
        return this.eventQueue.pop(queueName);
    }
    reset(queueName) {
        return this.eventQueue.reset(queueName);
    }
    resetAll() {
        EventManager_1.DEFAULT_PRIORITIES = { PRIORITY_TOTAL: 0 };
        return this.eventQueue.resetAll();
    }
    async notifyTaskNeeded(queueName, index = 0) {
        try {
            const url = this.eventQueue.notifyNeedTaskURLS[index];
            if (!url) {
                return;
            }
            await request_promise_1.default(url);
        }
        catch (error) {
            log(error);
        }
        await this.notifyTaskNeeded(queueName, index + 1);
    }
};
EventManager.DEFAULT_PRIORITIES = { PRIORITY_TOTAL: 0 };
EventManager = EventManager_1 = __decorate([
    inversify_1.injectable(),
    __param(0, inversify_1.inject(event_queue_1.EventQueue)),
    __metadata("design:paramtypes", [event_queue_1.EventQueue])
], EventManager);
exports.EventManager = EventManager;
//# sourceMappingURL=event-manager.js.map