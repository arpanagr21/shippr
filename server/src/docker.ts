import Docker from 'dockerode';

export const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export interface ContainerLogLine {
  text: string;
  type: 'stdout' | 'stderr';
  ts:   number;  // Unix seconds (float)
}

// Docker multiplexed log format: 8-byte header per frame
// byte 0 = stream type (1=stdout, 2=stderr), bytes 4-7 = big-endian uint32 length
export function demuxLogs(buf: Buffer): ContainerLogLine[] {
  const lines: ContainerLogLine[] = [];
  let offset = 0;

  while (offset + 8 <= buf.length) {
    const streamType = buf[offset];
    const len = buf.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + len > buf.length) break;

    const chunk = buf.subarray(offset, offset + len).toString('utf8');
    offset += len;

    const type: 'stdout' | 'stderr' = streamType === 2 ? 'stderr' : 'stdout';
    for (const raw of chunk.split('\n')) {
      if (!raw) continue;
      // timestamps: true → "2024-01-01T00:00:00.000000000Z <text>"
      const m = raw.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z) ([\s\S]*)$/);
      if (m) {
        lines.push({ text: m[2], type, ts: new Date(m[1]).getTime() / 1000 });
      } else {
        lines.push({ text: raw, type, ts: 0 });
      }
    }
  }

  return lines;
}
