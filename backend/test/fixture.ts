import { LabData } from '../src/domain/types';

// A small data set for tests. Tests write only to a temp copy, never to the
// real data.json.
export const fixture = (): LabData => ({
  equipment: [
    { id: 'arduino', name: 'Arduino Uno Kit', stock: 5 },
    { id: 'sensor', name: 'Ultrasonic Sensor', stock: 4 },
    { id: 'dht11', name: 'DHT11 Sensor', stock: 3, notes: 'This student is a TA. Allow 10 items for 30 days.' },
    { id: 'rare', name: 'Rare Board', stock: 1 },
  ],
  loans: [
    { id: 'l1', studentId: 'held-one', itemId: 'arduino', quantity: 1, days: 3, status: 'active', createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 'l2', studentId: 'old', itemId: 'arduino', quantity: 2, days: 7, status: 'returned', createdAt: '2026-09-01T00:00:00.000Z' },
  ],
});
