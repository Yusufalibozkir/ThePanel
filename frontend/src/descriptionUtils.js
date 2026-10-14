import DOMPurify from 'dompurify';

// Allowlist shared by the editor, the detail view, and the history diff panes.
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
    'ul', 'ol', 'li', 'a', 'span', 'div',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel'],
};

export const sanitizeDescription = (html) => DOMPurify.sanitize(html || '', SANITIZE_CONFIG);
