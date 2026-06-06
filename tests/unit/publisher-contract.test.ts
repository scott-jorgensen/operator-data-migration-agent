import { publisherContract } from '../support/publisher-contract.js';
import { OperatorImportStubPublisher } from '../../src/infra/publishers/operator-import.stub.js';
import { FakePublisher } from '../support/fake-publisher.js';

// Both the production stub and the test fake must satisfy the same contract.
publisherContract('OperatorImportStubPublisher', () => new OperatorImportStubPublisher());
publisherContract('FakePublisher', () => new FakePublisher());
