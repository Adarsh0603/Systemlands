import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'A race condition happens when two requests read the same value, both decide on it, and both write. Selling the last seat is the classic case: both buyers read “1 left”, both write “0 left”, and the seat is sold twice. The count even looks right afterwards, which is why races are hard to spot.',
    'The fix is to make the read and the write one step that nobody else can get between. In one database, the simplest way is an atomic conditional update: UPDATE seats SET left = left - 1 WHERE id = 7 AND left > 0, and check that one row changed.',
    'Pessimistic locking takes a lock before reading, for example SELECT … FOR UPDATE, so others wait until it is released. It is always correct and costs waiting. Keep the work inside the lock short: never call a payment provider or wait for a user while holding it.',
    'A row every request writes, such as a seat count or a like counter, is a hot row. A lock on it serialises everyone. Spread the work: split the count into several rows, hold seats per section, or put buyers in a queue and let one worker assign seats.',
    'Optimistic locking keeps a version number on the row. Write “set left = 0, version = 8 where version = 7”. If no row changed, someone else wrote first: read again and retry. It needs no lock and no extra trip, and wastes work when collisions are common.',
    'Choose by contention. Few collisions: optimistic, because almost every write succeeds the first time. Many collisions on the same row: pessimistic or a queue, because optimistic retries pile up and load the database.',
    'Across many servers, a lock lives in a lock service such as Redis, ZooKeeper or etcd. Give it a lease (a time to live) so that a crashed holder cannot block everyone for ever. The lease must be longer than the work, and short enough that a crash does not stop the system for long.',
    'A lease is not enough on its own. A holder can pause (a long garbage collection, a slow disk, a stalled VM) past its lease and then write as if it still held the lock. Use fencing tokens: each grant carries a number that goes up, and the storage turns down writes with a number lower than one it has already seen.',
  ],
  cards: [
    { title: 'The race', body: 'Two buyers read “1 left” and both write “0 left”. The count looks fine, and the seat is sold twice.' },
    { title: 'Pessimistic', body: 'Take a lock before reading. Others wait. Correct, and costs waiting, so keep the work inside the lock short.' },
    { title: 'Optimistic', body: 'Write only if the version is still the one you read. If not, read again and retry. Cheap when collisions are rare.' },
    { title: 'Which one?', body: 'Few collisions: optimistic. Many on the same row: a lock or a queue, because retries pile up.' },
    { title: 'Leases', body: 'A distributed lock expires by itself, so a crashed holder cannot block everyone. Longer than the work, short enough to recover.' },
    { title: 'Fencing tokens', body: 'Each grant carries a number that goes up. Storage turns down writes with an older number, so a holder that woke up late cannot overwrite newer work.' },
    { title: 'In the real world', body: 'Databases use SELECT … FOR UPDATE and version columns. Distributed locks use Redis, ZooKeeper or etcd, with leases and fencing tokens. Ticketing sites hold a seat for a few minutes while you pay.' },
  ],
}
