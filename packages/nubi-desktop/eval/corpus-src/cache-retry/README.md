# Cache lookup service

Current implementation is in src/. Run checks with npm test.

## Historical proposal (2024, never implemented)
The proposed cache would deep-clone values, coalesce concurrent requests and abort network requests immediately. These are design notes, not current behavior.
