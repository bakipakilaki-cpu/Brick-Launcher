import { gunzipSync, gzipSync } from 'node:zlib'

/**
 * Minimal NBT reader/writer — just enough for servers.dat, which is a plain
 * (uncompressed) compound holding a list of server entries. Avoids pulling in
 * a dependency for one small, stable binary format.
 */

export const TAG = {
  End: 0,
  Byte: 1,
  Short: 2,
  Int: 3,
  Long: 4,
  Float: 5,
  Double: 6,
  ByteArray: 7,
  String: 8,
  List: 9,
  Compound: 10,
  IntArray: 11,
  LongArray: 12
} as const

export type NbtValue =
  | number
  | bigint
  | string
  | Buffer
  | NbtValue[]
  | { [key: string]: NbtTagged }
  | number[]

/** A value paired with its NBT type, so writing can round-trip faithfully. */
export interface NbtTagged {
  type: number
  value: NbtValue
  /** Element type for lists. */
  listType?: number
}

class Reader {
  private offset = 0
  constructor(private buf: Buffer) {}

  byte(): number {
    return this.buf.readInt8(this.offset++)
  }
  short(): number {
    const v = this.buf.readInt16BE(this.offset)
    this.offset += 2
    return v
  }
  int(): number {
    const v = this.buf.readInt32BE(this.offset)
    this.offset += 4
    return v
  }
  long(): bigint {
    const v = this.buf.readBigInt64BE(this.offset)
    this.offset += 8
    return v
  }
  float(): number {
    const v = this.buf.readFloatBE(this.offset)
    this.offset += 4
    return v
  }
  double(): number {
    const v = this.buf.readDoubleBE(this.offset)
    this.offset += 8
    return v
  }
  string(): string {
    const length = this.buf.readUInt16BE(this.offset)
    this.offset += 2
    const v = this.buf.toString('utf8', this.offset, this.offset + length)
    this.offset += length
    return v
  }
  bytes(count: number): Buffer {
    const v = this.buf.subarray(this.offset, this.offset + count)
    this.offset += count
    return Buffer.from(v)
  }
  get done(): boolean {
    return this.offset >= this.buf.length
  }

  payload(type: number): NbtValue {
    switch (type) {
      case TAG.Byte:
        return this.byte()
      case TAG.Short:
        return this.short()
      case TAG.Int:
        return this.int()
      case TAG.Long:
        return this.long()
      case TAG.Float:
        return this.float()
      case TAG.Double:
        return this.double()
      case TAG.ByteArray:
        return this.bytes(this.int())
      case TAG.String:
        return this.string()
      case TAG.List: {
        const elementType = this.byte()
        const count = this.int()
        const items: NbtValue[] = []
        for (let i = 0; i < count; i++) items.push(this.payload(elementType))
        // Preserve the element type by stashing it on the array.
        ;(items as NbtValue[] & { elementType?: number }).elementType = elementType
        return items
      }
      case TAG.Compound: {
        const out: Record<string, NbtTagged> = {}
        for (;;) {
          const tagType = this.byte()
          if (tagType === TAG.End) break
          const name = this.string()
          const value = this.payload(tagType)
          const tagged: NbtTagged = { type: tagType, value }
          if (tagType === TAG.List) {
            tagged.listType =
              (value as NbtValue[] & { elementType?: number }).elementType ?? TAG.End
          }
          out[name] = tagged
        }
        return out
      }
      case TAG.IntArray: {
        const count = this.int()
        const arr: number[] = []
        for (let i = 0; i < count; i++) arr.push(this.int())
        return arr
      }
      case TAG.LongArray: {
        const count = this.int()
        const arr: NbtValue[] = []
        for (let i = 0; i < count; i++) arr.push(this.long())
        return arr as NbtValue
      }
      default:
        throw new Error(`Unsupported NBT tag type ${type}`)
    }
  }
}

class Writer {
  private chunks: Buffer[] = []

  byte(v: number): void {
    const b = Buffer.alloc(1)
    b.writeInt8(v)
    this.chunks.push(b)
  }
  short(v: number): void {
    const b = Buffer.alloc(2)
    b.writeInt16BE(v)
    this.chunks.push(b)
  }
  int(v: number): void {
    const b = Buffer.alloc(4)
    b.writeInt32BE(v)
    this.chunks.push(b)
  }
  long(v: bigint): void {
    const b = Buffer.alloc(8)
    b.writeBigInt64BE(v)
    this.chunks.push(b)
  }
  float(v: number): void {
    const b = Buffer.alloc(4)
    b.writeFloatBE(v)
    this.chunks.push(b)
  }
  double(v: number): void {
    const b = Buffer.alloc(8)
    b.writeDoubleBE(v)
    this.chunks.push(b)
  }
  string(v: string): void {
    const data = Buffer.from(v, 'utf8')
    const len = Buffer.alloc(2)
    len.writeUInt16BE(data.length)
    this.chunks.push(len, data)
  }
  raw(b: Buffer): void {
    this.chunks.push(b)
  }
  result(): Buffer {
    return Buffer.concat(this.chunks)
  }

  payload(type: number, value: NbtValue, listType?: number): void {
    switch (type) {
      case TAG.Byte:
        return this.byte(Number(value))
      case TAG.Short:
        return this.short(Number(value))
      case TAG.Int:
        return this.int(Number(value))
      case TAG.Long:
        return this.long(BigInt(value as bigint))
      case TAG.Float:
        return this.float(Number(value))
      case TAG.Double:
        return this.double(Number(value))
      case TAG.ByteArray: {
        const buf = value as Buffer
        this.int(buf.length)
        return this.raw(buf)
      }
      case TAG.String:
        return this.string(String(value))
      case TAG.List: {
        const items = value as NbtValue[]
        const element =
          listType ?? (items as NbtValue[] & { elementType?: number }).elementType ?? TAG.End
        // An empty list still needs a declared element type.
        this.byte(items.length === 0 ? TAG.End : element)
        this.int(items.length)
        for (const item of items) this.payload(element, item)
        return
      }
      case TAG.Compound: {
        const map = value as Record<string, NbtTagged>
        for (const [name, tag] of Object.entries(map)) {
          this.byte(tag.type)
          this.string(name)
          this.payload(tag.type, tag.value, tag.listType)
        }
        return this.byte(TAG.End)
      }
      case TAG.IntArray: {
        const arr = value as number[]
        this.int(arr.length)
        for (const n of arr) this.int(n)
        return
      }
      default:
        throw new Error(`Unsupported NBT tag type ${type}`)
    }
  }
}

export interface NbtFile {
  rootName: string
  root: Record<string, NbtTagged>
  gzipped: boolean
}

export function readNbt(input: Buffer): NbtFile {
  const gzipped = input[0] === 0x1f && input[1] === 0x8b
  const buf = gzipped ? gunzipSync(input) : input

  const reader = new Reader(buf)
  const type = reader.byte()
  if (type !== TAG.Compound) throw new Error('NBT root is not a compound tag')
  const rootName = reader.string()
  const root = reader.payload(TAG.Compound) as Record<string, NbtTagged>
  return { rootName, root, gzipped }
}

export function writeNbt(file: NbtFile): Buffer {
  const writer = new Writer()
  writer.byte(TAG.Compound)
  writer.string(file.rootName)
  writer.payload(TAG.Compound, file.root)
  const out = writer.result()
  return file.gzipped ? gzipSync(out) : out
}
