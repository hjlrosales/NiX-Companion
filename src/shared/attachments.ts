import { extname } from 'node:path';
import { z } from 'zod';

export const MAX_ATTACHMENT_SIZE = 50_000_000;
export const MAX_ATTACHMENTS = 20;

export const attachmentProcessorTypes = ['image', 'document', 'audio', 'video', 'code', 'spreadsheet', 'fallback'] as const;
export type AttachmentProcessorType = typeof attachmentProcessorTypes[number];
export type AttachmentStatus = 'queued' | 'processing' | 'ready' | 'error';

export const processedAttachmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(260),
  mimeType: z.string().min(1).max(120),
  size: z.number().int().min(0).max(MAX_ATTACHMENT_SIZE),
  source: z.string().min(1).max(1000),
  status: z.enum(['queued', 'processing', 'ready', 'error']),
  processorType: z.enum(attachmentProcessorTypes),
  extractedContent: z.string().max(20000).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  error: z.string().max(500).optional()
}).strict();
export type ProcessedAttachment = z.infer<typeof processedAttachmentSchema>;

const mimeByExtension: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.xml': 'application/xml',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.py': 'text/x-python',
  '.ps1': 'text/x-powershell',
  '.html': 'text/html',
  '.css': 'text/css',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska'
};

const signatures: Array<{ bytes: number[]; mimeType: string }> = [
  { bytes: [0x89, 0x50, 0x4e, 0x47], mimeType: 'image/png' },
  { bytes: [0xff, 0xd8, 0xff], mimeType: 'image/jpeg' },
  { bytes: [0x47, 0x49, 0x46, 0x38], mimeType: 'image/gif' },
  { bytes: [0x25, 0x50, 0x44, 0x46], mimeType: 'application/pdf' },
  { bytes: [0x50, 0x4b, 0x03, 0x04], mimeType: 'application/zip' },
  { bytes: [0x52, 0x49, 0x46, 0x46], mimeType: 'audio/wav' }
];

export function detectMimeType(name: string, header = Buffer.alloc(0)) {
  const signature = signatures.find(item => item.bytes.every((byte, index) => header[index] === byte));
  const extensionMime = mimeByExtension[extname(name).toLowerCase()];
  if (signature?.mimeType === 'application/zip' && extensionMime) return extensionMime;
  return signature?.mimeType ?? extensionMime ?? 'application/octet-stream';
}

export function processorForAttachment(name: string, mimeType: string): AttachmentProcessorType {
  const extension = extname(name).toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (['.csv', '.tsv', '.xlsx', '.xls'].includes(extension) || mimeType.includes('spreadsheet') || mimeType === 'text/csv') return 'spreadsheet';
  if (['.js', '.jsx', '.ts', '.tsx', '.py', '.ps1', '.sh', '.html', '.css', '.json', '.yaml', '.yml', '.xml', '.inp', '.dat', '.log'].includes(extension)) return 'code';
  if (mimeType.startsWith('text/') || ['.pdf', '.doc', '.docx', '.pptx', '.md', '.markdown'].includes(extension)) return 'document';
  return 'fallback';
}

export function attachmentContext(attachments: ProcessedAttachment[]) {
  const ready = attachments.filter(attachment => attachment.status === 'ready');
  if (!ready.length) return '';
  return `\n\nAttached file context:\n${ready.map(attachment => {
    const body = attachment.extractedContent?.trim() || 'No textual extraction is available yet; use this routing metadata only.';
    return `- ${attachment.name} (${attachment.mimeType}, ${attachment.processorType})\n${body}`;
  }).join('\n\n')}`;
}
