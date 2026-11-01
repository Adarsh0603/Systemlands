import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Clarify first: one-to-one and group chats, group size, media, delivery and read receipts, online status, several devices per person, how long a message is kept for an offline phone, and end-to-end encryption.',
    'Estimate: 2 billion people sending 50 messages a day is 100 billion messages, about 1.2 million a second. A quarter connected at once is 500 million connections. A gateway holds about a million, so about 500 gateways. Photos of 200 KB in one message in ten add about 2 PB a day. Pings every 10 seconds from 500 million phones are 50 million a second.',
    'Shape: a phone holds a persistent connection to a gateway. A message is written to a store keyed by the recipient, and only then acknowledged to the sender (the first tick). A delivery worker pushes it to every device of the recipient that is online. A device that is off collects its messages when it reconnects. Receipts travel back as small messages. Photos go to a file store and the message carries a link.',
    'Scale: shard the message store by recipient, find a user’s gateway through a lookup, keep presence in memory with an expiry, store a group message once and fan it out from that copy, and batch receipts.',
    'Failures: when a gateway falls, its phones reconnect, so spread them out with random delays and backoff. The sender retries until the message is acknowledged, and message ids drop duplicates. A message for a phone that stays away longer than the retention (about a month) is dropped.',
    'End-to-end encryption means the server stores and forwards sealed envelopes, one per recipient device. It cannot read, search or repair a message, so multi-device and group chats multiply the envelopes.',
  ],
  cards: [
    { title: 'The numbers', body: '2 billion people × 50 messages is 100 billion a day, about 1.2 million a second. 500 million open connections need about 500 gateways. Pings every 10 s from those phones are 50 million a second. Photos add about 2 PB a day.' },
    { title: 'Store first', body: 'A message is written to a shard before the sender sees the first tick. The shard is also the offline queue: it keeps the message until every device has it, for weeks if needed. Kept too briefly, a phone back from a long trip finds nothing. Kept too long, the disks fill.' },
    { title: 'Groups', body: 'A group message has one content for every member. Store it once with the member list and push from that copy. Storing a copy for every member makes a group of hundreds a burst of hundreds of writes.' },
    { title: 'Photos and receipts', body: 'A photo is thousands of times bigger than a text. Put it in a file store and send a link. Every message makes delivered and read receipts. Send them in batches, or they double the load on the gateways.' },
    { title: 'Presence', body: 'Phones ping every few seconds, and three missed pings make one offline. Keep it in memory with an expiry, away from the message shards. Send a status change only to the chats on screen, not to every contact.' },
    { title: 'When a gateway falls', body: 'Its phones all reconnect at once to the others. Each waits a random moment first, so the survivors see a stream. Unacknowledged messages are sent again by the phones, and ids drop the duplicates.' },
    { title: 'Encryption', body: 'End-to-end encrypted messages are sealed envelopes the server cannot read. It stores and forwards one per device, so a person with four devices, or a group, multiplies the envelopes.' },
  ],
}
