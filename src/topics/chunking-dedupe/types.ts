import type { BaseBeat, Chapter } from '../../core/types'
import type { ChunkMetrics, ChunkSim } from './engine'

// How the laptop cuts a file:
//   whole:   no cuts, one chunk
//   fixed:   every `size` units
//   content: after a unit whose neighbourhood matches a pattern, about every `size` units
export type Mode = 'whole' | 'fixed' | 'content'

export interface ChunkState {
  mode: Mode
  size: number // units in a chunk, on average
  ask: boolean // the laptop asks the store which chunks it lacks, and sends only those
  edit: number // goes up each time a line in the middle of the file is changed
  insert: number // goes up each time a line is added at the top
  copy: number // goes up each time another person uploads the same file
  round: number // goes up to start again
}

export type TagId = 'parties' | 'names' | 'who'
export type HudId = 'sent' | 'total' | 'chunks' | 'stored' | 'uploads'
export type ControlId = 'edit' | 'insert' | 'copy' | 'mode' | 'size' | 'ask'

export interface Beat extends BaseBeat<ChunkState, ChunkSim, ChunkMetrics> {
  tags?: TagId[]
  hud?: HudId[]
  controls?: ControlId[]
}

export type ChunkChapter = Chapter<ChunkState, Beat>
