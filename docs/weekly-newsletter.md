# Weekly newsletter

The Weekly lives at **Admin → Weekly newsletter**. Edit its subject and complete Markdown body, including the introduction, stories, facts, company selection, market summary and links. Headings, bold/italic text, lists, quotes and standalone images are supported. HTML is shown as text; links and images accept http/https destinations. The branded email frame and subscription-management footer are supplied automatically.

Saved editions retain the newsletter's styled sections: Top story gets its headline hierarchy, Company of the week gets a compact logo card, and Fact Flow gets accent callouts. LocStock, directory entries and further reading keep compact spacing and section dividers. The standard `##` section headings select these layouts; renamed or additional headings keep normal Markdown styling. All copy and destinations come from the saved edition, including removed or replaced links. Existing saved Markdown gets the improved presentation without refreshing or rewriting its content. New automatically assembled working copies also include editable story/profile links and the Why it matters label.

1. Start with the automatically assembled issue or open the saved edition.
2. Edit the subject and content, then **Save edition**.
3. Open **View saved preview** to inspect exactly that saved content.
4. Select all subscribers or one subscriber, then **Check recipients**.
5. **Confirm send** only when the content and recipients are correct.

Editing the content or changing recipients clears the send confirmation. Unsaved edits disable preview and sending. The server also checks the saved revision, so a preview from an older tab cannot silently send a changed edition. Conflicting saves require a reload. Refresh from latest content updates the working copy; it does not replace the saved edition until Save is chosen.

## Friday editions

Editions are keyed by their Friday date in Europe/Warsaw, including DST. Saturday begins the next edition. A saved complete edition is used by both manual delivery and the existing Friday 13:00 schedule. It is frozen until edited again; later source/article changes do not rewrite it. Without a saved edition for that Friday, the existing automatic issue continues. A past edition is never reused for a new week.

Targeted single-subscriber sends, the resend guard, unsubscribe headers and per-recipient manage links retain their existing behavior. `digest_sends` keeps the exact subject and rendered HTML of each delivered message, so editing a future edition does not alter sent history.

## Database and rollout

Apply `supabase/migrations/20261124_weekly_newsletter_editions.sql` before using the complete editor. The new table is private, has RLS enabled, and grants access only to the service role; the API additionally requires the admin session. The database enforces Friday dates, nonempty content, a 200-character subject and a 60,000-character body.

Only a specifically missing editions table allows scheduled delivery to fall back to the prior automatic issue during rollout. Permission, connectivity and invalid-data errors stop delivery rather than omit saved edits. The legacy intro-note table/API is retained for compatibility and supplies the opening note when assembling a new automatic issue; a saved complete edition takes precedence.

## Verification

`npm test` covers edition validation, week boundaries, private-table constraints, authentication, conflicting saves, preview/send consistency, cron behavior and fact-link editing. Rendering tests check safe Markdown and preserve the managed subscription footer. Delivery is mocked in tests.

Use the isolated editorial fixture described in `docs/research-workflow.md`, then run:

```sh
TEST_BASE_URL=http://127.0.0.1:3000 PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chromium node tests/admin-seven-areas.browser.cjs
```

The browser check edits a complete edition, saves/reloads it, inspects the real HTML preview and checks dirty-state/confirmation behavior. Send requests are intercepted and must be dry runs. Screenshots are saved under `work/admin-preview/`. The older admin-workspace and weekly-note browser script names remain compatibility entry points for this consolidated check.

`PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chromium node tests/weekly-formatting.browser.cjs` compares the styled saved document with the automatic newsletter and checks the story, company card, facts, links and mobile widths. Add `TEST_BASE_URL` for the isolated app to verify persistence and the real saved-preview route too. Screenshots go to `work/weekly-preview/`; the check never calls delivery.
