# Editable opening paragraph for The Weekly

In **Admin → Dashboard → Send The Weekly**, use **Opening paragraph** to add a short personal introduction above the top story. The field is optional Markdown text, limited to 2,000 characters. Line breaks are combined into one paragraph. Supported formatting:

- `**bold**` or `__bold__`
- `*italics*` or `_italics_`
- `[link text](https://example.com)` with HTTP or HTTPS destinations
- Nested formatting, such as `[**bold link**](https://example.com)`

Use **View sample** after saving to see the formatted email. Raw HTML and unsupported markup (including images) display as text. Unsafe or non-web link destinations render their label without a clickable link. Existing paragraphs are stored as before; no additional migration is needed for Markdown support.

1. Check the Friday edition date shown next to the field.
2. Edit the paragraph and choose **Save paragraph**.
3. Use **View sample** to inspect the actual newsletter. **Preview** still checks recipients and opens the existing send confirmation.
4. Confirm a manual send if needed, or leave the saved paragraph for the scheduled Friday send.

Saving never sends email. Unsaved edits disable sample/recipient previews and clear an earlier send confirmation. Clear the field and save to remove the paragraph. The saved paragraph is shared by sample rendering, manual sends and the scheduled send. Previously sent emails retain their original text in the existing HTML snapshots in Weekly history.

Monday through Friday use that Friday's edition in `Europe/Warsaw`; Saturday starts the next edition. Each edition has its own saved paragraph, so text is not automatically reused the following week. A page left open across the rollover must reload before saving. A manual send uses the edition currently shown by the editor; it still covers the existing rolling seven-day content window.

## Deployment

Apply `supabase/migrations/20261116_weekly_newsletter_notes.sql` through the normal Supabase migration process before using the field. The new table stores paragraphs by Friday edition date, enables RLS and grants access only to the server's service role. The note API separately requires an authenticated admin session.

Before the migration is installed, the editor displays the migration requirement. Existing send and sample endpoints retain their original no-paragraph behavior when this specific table is absent. Other database read failures stop preview/send rather than silently dropping saved copy. This change does not alter the sending schedule, recipients, subject, resend guard or subscription preferences. Rollback can retain the new table and revert the application without deleting editorial copy.

## Validation

`npm test` includes the weekly-edition date rules, paragraph validation, authenticated note API, formatted HTML output, shared issue building and private-table permissions in PostgreSQL WASM.

Run the isolated Supabase fixture and app using the setup in `docs/research-workflow.md`, then run:

```sh
PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chromium node tests/weekly-note.browser.cjs
```

This browser check exercises the real note API and sample renderer against the local fixture. Sending is intercepted; no email service or live database is used.
