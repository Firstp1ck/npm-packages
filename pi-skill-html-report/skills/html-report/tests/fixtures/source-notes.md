# Representative source notes

A staged service migration must preserve data integrity and support rollback.

- Prepare: inventory dependencies and establish a verified backup.
- Migrate: move one bounded workload and record reconciliation counts.
- Verify: compare records, test critical paths, and approve cutover only after checks pass.
- Evidence: command output, record counts, and approval status are available.
- Constraint: no quantitative performance claim should be graphed unless measured values are supplied.
