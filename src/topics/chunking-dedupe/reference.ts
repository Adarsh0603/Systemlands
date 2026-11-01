import type { Reference } from '../../core/types'

export const REFERENCE: Reference = {
  interview: [
    'Chunking splits a file into pieces so that a small change sends a small piece. Each chunk is named by a hash of its content. A file is then a list of chunk hashes, and the store keeps chunks by hash.',
    'To upload, the client sends the list of hashes and the store answers with the ones it lacks. Only those chunks travel. If the store already has a chunk, from this user or any other, nothing is sent or stored again. That is deduplication.',
    'Fixed-size chunking cuts every N bytes. It is simple and fast, but one byte inserted near the start shifts every later cut, so none of the later chunks match the old ones. Content-defined chunking decides cuts from the data: a rolling hash over a small window cuts where it matches a pattern. The cuts stay with the content, so an insert changes only the chunk around it.',
    'Chunk size is a trade-off. Small chunks send less per edit and dedupe better, but the metadata grows: more hashes to store, more to ask about, more requests. Large chunks are cheap to track and resend too much. Systems usually choose a few megabytes (about 4 MB), or set a minimum, an average and a maximum size for content-defined cuts.',
    'The store needs a chunk index from hash to location, with a reference count so a chunk is deleted only when no file uses it. Keep chunks immutable. A file version is a new list of hashes.',
    'Deduplication across users leaks information: if the store says it already has a chunk, a client learns that someone uploaded it. Defences: dedupe only within an account, or require the client to prove it holds the bytes, for example by hashing a random part of the chunk chosen by the server. Encrypting before upload hides content but defeats cross-user dedupe, unless the key comes from the content.',
    'It pays off for large files with small edits, many copies of the same data, and backups of data that changes slowly. It costs CPU on the client to hash every byte and is wasted on data that is already compressed or random.',
  ],
  cards: [
    { title: 'The idea', body: 'Cut a file into chunks, name each by a hash of its content, and ask the store which names it lacks. Only those chunks travel.' },
    { title: 'Chunk size', body: 'About 4 MB is typical. Smaller chunks send less per edit and match more often, and make a longer list to track. Larger chunks are cheaper to track and send too much.' },
    { title: 'Fixed vs content-defined', body: 'Fixed cuts every N bytes, so an insert shifts every later cut and nothing matches. Content-defined cuts where a rolling hash matches a pattern, so cuts stay with the data and an insert changes one chunk.' },
    { title: 'Dedupe', body: 'A chunk with a known hash is never stored or sent twice, across files, versions and users. Keep a reference count so a chunk is removed only when no file uses it.' },
    { title: 'Privacy', body: 'Telling a client “I already have this” reveals that someone has the file. Dedupe within an account, or ask the client to prove it holds the bytes.' },
    { title: 'In the real world', body: 'File sync such as Dropbox, backup tools such as restic and Borg, Git’s object store, and container image layers all store content by hash.' },
  ],
}
