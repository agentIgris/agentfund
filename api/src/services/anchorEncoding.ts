/**
 * Minimal Borsh + Anchor instruction-discriminator encoding, hand-rolled
 * against the exact account/arg layouts in each program's src/lib.rs (see
 * the doc comments on each encode* function). We deliberately don't
 * depend on a generated Anchor IDL/`Program` client here: IDLs are only
 * emitted by `anchor build`, which per this task's instructions is the
 * integration agent's job, not ours. Anchor's on-the-wire format is
 * simple enough (8-byte sighash + Borsh-serialized args) to encode
 * directly and keep in lockstep with the Rust source by hand.
 */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

/** Anchor instruction discriminator: first 8 bytes of sha256("global:<snake_case_name>"). */
export function anchorSighash(instructionName: string): Buffer {
  return createHash("sha256").update(`global:${instructionName}`).digest().subarray(0, 8);
}

export function encodeU8(value: number): Buffer {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(value, 0);
  return buf;
}

export function encodeBool(value: boolean): Buffer {
  return encodeU8(value ? 1 : 0);
}

export function encodeU32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

export function encodeU64(value: bigint | number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value), 0);
  return buf;
}

export function encodeI64(value: bigint | number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(value), 0);
  return buf;
}

/** Borsh string: u32 LE byte-length prefix + UTF-8 bytes (no NUL terminator). */
export function encodeString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([encodeU32(bytes.length), bytes]);
}

export function encodePubkey(value: PublicKey | string): Buffer {
  const pk = typeof value === "string" ? new PublicKey(value) : value;
  return Buffer.from(pk.toBytes());
}

/** Concatenates a sighash with Borsh-encoded args into full instruction data. */
export function buildInstructionData(instructionName: string, args: Buffer[]): Buffer {
  return Buffer.concat([anchorSighash(instructionName), ...args]);
}

/** Anchor event discriminator: first 8 bytes of sha256("event:<EventStructName>"). */
export function anchorEventDiscriminator(eventName: string): Buffer {
  return createHash("sha256").update(`event:${eventName}`).digest().subarray(0, 8);
}

/**
 * Sequential Borsh reader for decoding Anchor `#[event]` log payloads
 * (services/helius.ts). Mirrors the encode* helpers above field-for-field.
 */
export class BorshReader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  readU8(): number {
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }

  readBool(): boolean {
    return this.readU8() !== 0;
  }

  readU32(): number {
    const v = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return v;
  }

  readU64(): bigint {
    const v = this.buf.readBigUInt64LE(this.offset);
    this.offset += 8;
    return v;
  }

  readI64(): bigint {
    const v = this.buf.readBigInt64LE(this.offset);
    this.offset += 8;
    return v;
  }

  readString(): string {
    const len = this.readU32();
    const s = this.buf.toString("utf8", this.offset, this.offset + len);
    this.offset += len;
    return s;
  }

  readPubkey(): string {
    const bytes = this.buf.subarray(this.offset, this.offset + 32);
    this.offset += 32;
    return new PublicKey(bytes).toBase58();
  }
}
