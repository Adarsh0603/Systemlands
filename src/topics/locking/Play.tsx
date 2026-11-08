import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { locking } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={locking} index={chapter} startStep={step} {...rest} />
}
