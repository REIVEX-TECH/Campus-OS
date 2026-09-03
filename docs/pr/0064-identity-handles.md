# feat(identity): anonymous handles, the account page, and the change flow

Targets `main`. Identity PR 3. Still gates nothing.

## What

- **Generated handles.** First sign in now gets a real `Adjective_Noun_1234`
  instead of PR 2's placeholder. The vocabulary is 128 adjectives and 128 nouns
  of weather, landscape, materials, colours and animals: no nationalities,
  languages, religions, genders, names or body words, so a handle cannot say
  anything about the person holding it. With a four digit suffix that is over 147
  million combinations.
- **Uniqueness belongs to the database.** Every path generates or accepts a
  candidate, attempts the write, and treats a unique violation as "try again".
  Checking availability first and writing second would be a race, and the race is
  exactly the case that matters when two people sign in at the same moment.
- **The account page** at `/u/[slug]/account`: avatar, handle, a change form, and
  a re roll. The email appears once, labelled as private, so it is clear which
  address signs you in without ever implying it is public. Signed out, the page
  redirects to sign in; signed in, sign in redirects here.
- **The change flow** has three guards: shape and reserved words, a 30 day
  cooldown so a handle is worth recognising, and a 90 day reservation on the
  handle you leave so nobody can pick it up and be mistaken for you.
- **`public_profiles`**, a view of handle and avatar seed only. The protection is
  structural: the email is not a column, so no query against the view can select
  one. It is what future posts and comments should join against.

## A judgement call worth naming

Reserved words are matched in **two tiers**, because one rule could not do both
jobs. Distinctive terms (`admin`, `moderator`, `campusos`, `staff`) are refused
anywhere in a handle, so `SuperAdmin99` cannot borrow authority. Short ones
(`mod`, `team`, `root`) only count as a whole part, because `mod` inside `Modest`
and `team` inside `Stream` say nothing about anyone and refusing them would make
the rule feel arbitrary. A test asserts the generator can never produce a handle
its own rules would reject, which is how the first, blunter version was caught.

## Data & migration impact

Two migrations. `0005_public_profiles` adds the view and
`auth_handle_is_reserved`, a definer function answering the single yes or no
question a user is entitled to about a reserved handle without revealing whose it
was. `0006_resolve_user_profile` widens the sign in lookup to carry the avatar
seed and change time, so signing in still needs one read.

## Tests

- Unit (15 new, 23 total): generated handles always match the shape and only use
  the curated vocabulary; the vocabulary has no duplicates and contains no
  reserved word; the generator never produces something the validator would
  refuse; shape rejections; both tiers of reserved matching, including that
  `Modest_Otter_12` and `Stream_Finch_88` are fine; the cooldown; the reservation
  window.
- Integration (8 new): a new user gets a generated handle, a chosen handle sticks
  and records when, a second change inside the cooldown is refused, a handle held
  by someone else is refused, a **released handle is reserved against a squatter**,
  asking for the handle you already hold is a no-op that does not burn the
  cooldown, re rolling an avatar leaves the handle alone, and the public view
  exposes exactly three columns with no email among them.
- e2e (3 new, 43 total): the account page redirects when signed out, and both
  account endpoints refuse without a session.
- `pnpm turbo run typecheck lint build test` (24 tasks) passes.

## Verification steps

Sign in: the handle is `Adjective_Noun_1234`. Change it, and the form refuses a
second change, a reserved word, and a bad shape with a specific message. Re roll
the avatar and the handle is untouched.

## Follow-ups

- Identity PRs 4 and 5 are **out of scope pending review**, as agreed.
