# GraphQL Reads and Verification

Use the endpoint embedded in the generated plan. Never mix mainnet evidence
with a testnet write plan or the reverse.

## Agent identity preflight

The planner emits the complete `FindAgentByERC8004Identity` query, selected
endpoint, canonical `same as` term ID, and CAIP identity variable. It requests
up to two matches so ambiguity is visible.

Interpretation is strict:

- Zero matches: the canonical agent is absent; use the generated exact recipe.
- One match: reuse `subject.term_id`.
- More than one match: stop for manual resolution.

A raw CAIP text atom does not satisfy this preflight. The result must be a
Triple using the canonical `same as` predicate with a pinThing agent Atom as
subject. The object must match the complete canonical CAIP identity Thing:
exact name and description, with empty image and URL. A same-name lookalike is
an invalid response, not a zero-match result.

## Verify registry terms by ID

Use exact IDs from `registry.json`, never a label search, to prove each term is
created on the selected network:

```graphql
query VerifyTerms($ids: [String!]!) {
  atoms(where: { term_id: { _in: $ids } }) {
    term_id
    label
    data
    value { thing { name description image url } }
  }
}
```

Require one result for every requested ID. Labels are display metadata only.
Duplicate labels elsewhere in the graph do not affect canonical selection.

## Check planned Triples

Check exact subject, predicate, and object IDs before creation:

```graphql
query FindExactTriple($subjectId: String!, $predicateId: String!, $objectId: String!) {
  triples(
    where: {
      subject_id: { _eq: $subjectId }
      predicate_id: { _eq: $predicateId }
      object_id: { _eq: $objectId }
    }
    limit: 1
  ) {
    term_id
    subject_id
    predicate_id
    object_id
  }
}
```

Reuse an existing Triple. Do not attempt duplicate creation.

## Consumer read: providers and assessment sources

Read the two agent-outbound edges by exact predicate IDs. Then verify each
source's provider and type edges by their exact IDs. Fetch mutable assessment
content from the assessment-source Atom's `value.thing.url`.

Do not interpret `has trust provider` as endorsement. It declares that a
provider publishes trust or risk data about the agent.

## Post-broadcast checks

Require all of the following:

1. Transaction receipt succeeded.
2. Every expected atom and Triple term ID exists.
3. Exact Triple queries return the planned subject, predicate, and object.
4. The assessment-source Atom URL equals the partner's stable resolver URL.
5. The resolver returns readable content and declares freshness.
6. Canonical queries find the integration without any label fallback.
