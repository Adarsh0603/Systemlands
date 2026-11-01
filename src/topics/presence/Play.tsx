import Player from '../../core/Player'
import type { PlayProps } from '../registry'
import { presence } from './topic'

export default function Play({ chapter, step, ...rest }: PlayProps) {
  return <Player topic={presence} index={chapter} startStep={step} {...rest} />
}
