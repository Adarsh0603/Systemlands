import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Clarify first: file sizes, devices per user, sharing, how soon devices must be in sync, offline editing, versioning, and what happens when two devices edit the same file.',
    'Estimate: 100 million active users with 10 changes each is a billion changes a day, about 12,000 a second. At one 4 MB chunk each that is about 4 PB a day. With a third of the chunks already stored and three copies, about 8 PB of disk a day.',
    'Shape: the client cuts a file into chunks and hashes them. A metadata service keeps each file as a list of chunk hashes and says which ones the block store lacks. Only those are uploaded. A queue carries change notices to a notification service, which tells the other devices. They fetch the chunks they lack.',
    'Scale: shard the metadata by user or folder, shard blocks by hash, keep three copies on different racks, and batch notices for large shared folders.',
    'Failures: a crashed shard leaves other copies of every chunk. A lost notice is repaired when a device reconnects and asks for changes since its last version. Conflicting edits make a conflicted copy.',
  ],
  cards: [
    { title: 'The numbers', body: '100 million people with 10 changes a day is a billion changes, about 12,000 a second. One 4 MB chunk each is about 4 PB a day. Whole 100 MB files would be 25 times more. With a third deduped and three copies, about 8 PB of disk a day.' },
    { title: 'Chunks', body: 'A file is cut into chunks of a few megabytes, each named by its hash. An edit changes one or two chunks, and only those travel. Too small and the file lists grow huge. Too big and a one-line edit sends too much.' },
    { title: 'Content-defined chunking', body: 'Cut every 4 MB and a line added at the top moves every cut after it, so no chunk matches the old file. Cut where the content says, using a rolling hash, and the cuts stay with the text. Only the chunk around the edit is new.' },
    { title: 'Dedupe', body: 'If the store already has a chunk with that hash, nothing is sent or stored again. A file thousands of people upload costs the disk of one. Dedupe across accounts leaks whether someone has a file, so many systems check that the client really holds the bytes.' },
    { title: 'Metadata and blocks', body: 'Two stores. A metadata service keeps files, folders, versions and chunk lists, and needs strong consistency. A block store keeps chunks by hash, is huge, and is spread by hash. Three copies on different racks survive a rack losing power.' },
    { title: 'Telling the other devices', body: 'A commit puts a notice on a queue. Notifiers read it and tell each device, which asks for the chunks it lacks. A shared folder with thousands of devices makes thousands of notices from one change, so notices go in batches, and a device that missed one asks for changes since its last version.' },
  ],
}
