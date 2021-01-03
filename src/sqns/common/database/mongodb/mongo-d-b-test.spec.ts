import SQS from 'aws-sdk/clients/sqs';
import { expect } from 'chai';
import moment from 'moment';
import rp from 'request-promise';
import { MessageAttributeMap } from '../../../../../typings';
import { ChannelDeliveryPolicy } from '../../../../../typings/delivery-policy';
import { delay, dropDatabase, setupConfig } from '../../../../setup';
import { Env } from '../../../../test-env';
import { SQNSClient } from '../../../s-q-n-s-client';
import { WorkerEventScheduler } from '../../../scheduler/scheduler-worker/worker-event-scheduler';
import { MongoDBAdapter } from './mongo-d-b-adapter';

describe('mongoDB test cases', () => {
  context('SlaveEventSchedulerSpec', () => {
    let slaveScheduler: WorkerEventScheduler;
    let queue: SQS.Types.CreateQueueResult;
    let client: SQNSClient;

    beforeEach(async () => {
      await dropDatabase();
      client = new SQNSClient({
        endpoint: `${Env.URL}/api`,
        accessKeyId: Env.accessKeyId,
        secretAccessKey: Env.secretAccessKey,
      });
      queue = await client.createQueue({ QueueName: 'queue1' });
    });

    it('should call failure api when request fails in mongoDB. for exponential retry', async () => {
      const time = new Date().getTime() / -1000;
      await client.sendMessageBatch({
        QueueUrl: queue.QueueUrl,
        Entries: [
          { Id: '123', MessageBody: '123', DelaySeconds: time },
          { Id: '1234', MessageBody: '1234', DelaySeconds: time + 60 },
          { Id: '1235', MessageBody: '1235', DelaySeconds: time + 120 },
        ],
      });
      await new Promise((resolve: (value: unknown) => void) => {
        let count = 0;
        slaveScheduler = new WorkerEventScheduler(
          {
            endpoint: `${Env.URL}/api`,
            accessKeyId: Env.accessKeyId,
            secretAccessKey: Env.secretAccessKey,
          },
          ['queue1'],
          async () => {
            count += 1;
            if (count === 2) {
              return Promise.resolve('this is success message');
            }
            if (count === 3) {
              setTimeout(resolve, 0);
              return new Promise(() => 0);
            }
            return Promise.reject('Error in processing');
          },
          '*/2 * * * * *');
      });
      await delay();
      const stats = await rp({ uri: `${Env.URL}/api/queues/events/stats`, json: true });
      expect(stats).to.deep.equal({
        PRIORITY_TOTAL: 0,
        'arn:sqns:sqs:sqns:1:queue1': { PRIORITY_TOTAL: 0, PRIORITY_999999: 0 },
        PRIORITY_999999: 0,
      });
      const items = await setupConfig.mongoConnection.find('_Queue_Event', {}, { originalEventTime: 1 });
      expect(moment(items[0].originalEventTime).utc().format('YYYY-MM-DDTHH:mm')).to.equal('1970-01-01T00:00');
      expect(moment(items[1].originalEventTime).utc().format('YYYY-MM-DDTHH:mm')).to.equal('1970-01-01T00:01');
      expect(moment(items[2].originalEventTime).utc().format('YYYY-MM-DDTHH:mm')).to.equal('1970-01-01T00:02');
      items.forEach((item_: any) => {
        const item = item_;
        expect(item._id).to.exist;
        expect(item.createdAt).to.exist;
        expect(item.updatedAt).to.exist;
        expect(moment(item.eventTime).diff(moment(), 'seconds'), 'delay in event min time').to.be.at.least(58);
        expect(moment(item.eventTime).diff(moment(), 'seconds'), 'delay in event max time').to.be.at.most(60);
        expect(moment(item.sentTime).valueOf(), 'sentTime same firstSentTime').to.equal(moment(item.firstSentTime).valueOf());
        expect(moment(item.sentTime).valueOf(), 'sentTime min value').is.greaterThan(moment().add(-5, 'second').valueOf());
        expect(moment(item.sentTime).valueOf(), 'sent time max value').is.at.most(moment().valueOf());
        delete item._id;
        delete item.eventTime;
        delete item.originalEventTime;
        delete item.firstSentTime;
        delete item.sentTime;
        delete item.createdAt;
        delete item.updatedAt;
      });
      expect(JSON.parse(JSON.stringify(items))).to.deep.equal([{
        priority: 999999,
        receiveCount: 1,
        MessageSystemAttribute: {},
        maxReceiveCount: 3,
        data: {},
        queueARN: 'arn:sqns:sqs:sqns:1:queue1',
        MessageBody: '123',
        MessageAttribute: {},
        state: 'FAILURE',
        processingResponse: 'sent to slave',
        failureResponse: 'Event marked failed without response.',
        DeliveryPolicy: {
          numRetries: 3,
          numNoDelayRetries: 0,
          minDelayTarget: 20,
          maxDelayTarget: 20,
          numMinDelayRetries: 0,
          numMaxDelayRetries: 0,
          backoffFunction: 'exponential',
        },
      }, {
        priority: 999999,
        receiveCount: 1,
        MessageSystemAttribute: {},
        maxReceiveCount: 3,
        data: {},
        queueARN: 'arn:sqns:sqs:sqns:1:queue1',
        MessageBody: '1234',
        MessageAttribute: {},
        state: 'PROCESSING',
        processingResponse: 'sent to slave',
        DeliveryPolicy: {
          numRetries: 3,
          numNoDelayRetries: 0,
          minDelayTarget: 20,
          maxDelayTarget: 20,
          numMinDelayRetries: 0,
          numMaxDelayRetries: 0,
          backoffFunction: 'exponential',
        },
      }, {
        priority: 999999,
        receiveCount: 1,
        MessageSystemAttribute: {},
        maxReceiveCount: 3,
        data: {},
        queueARN: 'arn:sqns:sqs:sqns:1:queue1',
        MessageBody: '1235',
        MessageAttribute: {},
        state: 'SUCCESS',
        processingResponse: 'sent to slave',
        successResponse: 'this is success message',
        DeliveryPolicy: {
          numRetries: 3,
          numNoDelayRetries: 0,
          minDelayTarget: 20,
          maxDelayTarget: 20,
          numMinDelayRetries: 0,
          numMaxDelayRetries: 0,
          backoffFunction: 'exponential',
        },
      }]);
    });

    it('should call failure api when request fails in mongoDB. for linear retry', async () => {
      const time = new Date().getTime() / -1000;
      const deliveryPolicy: ChannelDeliveryPolicy = {
        numRetries: 3,
        numNoDelayRetries: 0,
        minDelayTarget: 20,
        maxDelayTarget: 20,
        numMinDelayRetries: 0,
        numMaxDelayRetries: 0,
        backoffFunction: 'linear',
      };
      const messageAttributes: MessageAttributeMap = {
        DeliveryPolicy: { DataType: 'String', StringValue: JSON.stringify(deliveryPolicy) },
      };
      await client.sendMessageBatch({
        QueueUrl: queue.QueueUrl,
        Entries: [
          { Id: '123', MessageBody: '123', DelaySeconds: time, MessageAttributes: messageAttributes },
          { Id: '1234', MessageBody: '1234', DelaySeconds: time + 60, MessageAttributes: messageAttributes },
          { Id: '1235', MessageBody: '1235', DelaySeconds: time + 120, MessageAttributes: messageAttributes },
        ],
      });
      await new Promise((resolve: (value: unknown) => void) => {
        let count = 0;
        slaveScheduler = new WorkerEventScheduler(
          {
            endpoint: `${Env.URL}/api`,
            accessKeyId: Env.accessKeyId,
            secretAccessKey: Env.secretAccessKey,
          },
          ['queue1'],
          async () => {
            count += 1;
            if (count === 2) {
              return Promise.resolve('this is success message');
            }
            if (count === 3) {
              setTimeout(resolve, 0);
              return new Promise(() => 0);
            }
            return Promise.reject('Error in processing');
          },
          '*/2 * * * * *');
      });
      await delay();
      const items = await setupConfig.mongoConnection.find('_Queue_Event', {}, { originalEventTime: 1 });
      items.forEach((item: any) => {
        expect(moment(item.eventTime).diff(moment(), 'seconds'), 'delay in event min time').to.be.at.least(598);
        expect(moment(item.eventTime).diff(moment(), 'seconds'), 'delay in event max time').to.be.at.most(600);
        expect(moment(item.sentTime).valueOf(), 'sentTime same firstSentTime').to.equal(moment(item.firstSentTime).valueOf());
        expect(moment(item.sentTime).valueOf(), 'sentTime min value').is.greaterThan(moment().add(-5, 'second').valueOf());
        expect(moment(item.sentTime).valueOf(), 'sent time max value').is.at.most(moment().valueOf());
      });
    });

    afterEach(() => slaveScheduler?.cancel());
  });

  context('retry of failed events', () => {
    let slaveScheduler: WorkerEventScheduler;
    let queue: SQS.Types.CreateQueueResult;
    let client: SQNSClient;

    beforeEach(async () => {
      await dropDatabase();
      client = new SQNSClient({
        endpoint: `${Env.URL}/api`,
        accessKeyId: Env.accessKeyId,
        secretAccessKey: Env.secretAccessKey,
      });
      queue = await client.createQueue({ QueueName: 'queue1' });
      await client.sendMessageBatch({
        QueueUrl: queue.QueueUrl,
        Entries: [{ Id: '123', MessageBody: '123' }],
      });
      await delay();
    });

    it('should update event status as failed when event is not processed successfully', async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        slaveScheduler = new WorkerEventScheduler(
          {
            endpoint: `${Env.URL}/api`,
            accessKeyId: Env.accessKeyId,
            secretAccessKey: Env.secretAccessKey,
          },
          ['queue1'],
          () => {
            setTimeout(resolve, 0);
            return Promise.reject('Error in processing');
          },
          '*/2 * * * * *');
      });
      await delay();
      const stats = await rp({ uri: `${Env.URL}/api/queues/events/stats`, json: true });
      expect(stats).to.deep.equal({
        PRIORITY_TOTAL: 0,
        'arn:sqns:sqs:sqns:1:queue1': { PRIORITY_TOTAL: 0, PRIORITY_999999: 0 },
        PRIORITY_999999: 0,
      });
      const queueItem = await setupConfig.mongoConnection.findOne('_Queue_Queues', { name: 'queue1' });
      const items = await setupConfig.mongoConnection.find('_Queue_Event', {}, { eventTime: -1 });
      items.forEach((item_: any) => {
        const item = item_;
        delete item.createdAt;
        delete item.updatedAt;
        delete item._id;
        delete item.sentTime;
        delete item.eventTime;
        delete item.firstSentTime;
        delete item.originalEventTime;
      });
      expect(JSON.parse(JSON.stringify(items))).to.deep.equal([{
        priority: 999999,
        receiveCount: 1,
        data: {},
        MessageBody: '123',
        MessageAttribute: {},
        MessageSystemAttribute: {},
        state: 'FAILURE',
        maxReceiveCount: 3,
        queueARN: 'arn:sqns:sqs:sqns:1:queue1',
        failureResponse: 'Event marked failed without response.',
        processingResponse: 'sent to slave',
        DeliveryPolicy: {
          numRetries: 3,
          numNoDelayRetries: 0,
          minDelayTarget: 20,
          maxDelayTarget: 20,
          numMinDelayRetries: 0,
          numMaxDelayRetries: 0,
          backoffFunction: 'exponential',
        },
      }]);
    });

    afterEach(() => slaveScheduler?.cancel());
  });

  context('error handling of mark event success or failure api', () => {
    beforeEach(async () => dropDatabase());

    it('should give error when uri is not present mongoDBAdapter', async () => {
      try {
        const adapter = new MongoDBAdapter({ uri: undefined });
        await Promise.reject({ code: 99, message: 'should not reach here', adapter });
      } catch (error) {
        expect(error.message).to.deep.equal('Database URI is missing');
      }
    });

    it('should give signature miss-match error when client credential are wrong', async () => {
      try {
        const client = new SQNSClient({
          endpoint: `${Env.URL}/api`,
          accessKeyId: 'wrongAccessKey',
          secretAccessKey: 'wrongSecret',
        });
        await client.markEventFailure('eventId', `${Env.URL}/api/sqs/sqns/1/queue1`, 'failureMessage');
        await Promise.reject({ code: 99, message: 'should not reach here.' });
      } catch (error) {
        const { code, message } = error;
        expect({ code, message }).to.deep.equal({
          code: 'SignatureDoesNotMatch',
          message: 'The request signature we calculated does not match the signature you provided.',
        });
      }
    });

    it('should give error when endpoint is wrong', async () => {
      try {
        const client = new SQNSClient({
          endpoint: `${Env.URL}/api/wrong`,
          accessKeyId: Env.accessKeyId,
          secretAccessKey: Env.secretAccessKey,
        });
        await client.markEventSuccess('eventId', `${Env.URL}/api/wrong/sqs/queue/queue1`, 'failureMessage');
        await Promise.reject({ code: 99, message: 'should not reach here.' });
      } catch (error) {
        const { code, message } = error;
        expect({ code, message }).to.deep.equal({
          code: 404,
          message: '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n'
              + '<body>\n<pre>Cannot POST /api/wrong/sqs/queue/queue1/event/eventId/success</pre>\n</body>\n</html>\n',
        });
      }
    });
  });
});
