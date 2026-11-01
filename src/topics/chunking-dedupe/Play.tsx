import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { chunkingDedupe } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={chunkingDedupe} index={chapter} startStep={step} {...rest} />
}
