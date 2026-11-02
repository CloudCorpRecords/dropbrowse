# Changelog

## 0.1.0 (2026-10-27)

- Initial release: five read-only Dropbox tools — `list_files`,
  `search_files`, `read_file`, `get_file_info`,
  `search_file_content` — over the Dropbox API v2 HTTPS endpoints,
  authenticated by the `DROPBOX_ACCESS_TOKEN` environment variable.
- Plain-text files are read and content-searched as text. PDF/DOCX
  text extraction is not implemented in this build and returns a
  named error (see README).
