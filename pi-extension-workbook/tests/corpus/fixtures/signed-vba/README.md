# Signed-VBA test fixture provenance

`xlsxwriter-macro04.xlsm` is a test-only signed-VBA workbook copied unchanged from the XlsxWriter repository:

- Repository: <https://github.com/jmcnamara/XlsxWriter>
- Pinned commit: `cf3fe78d3eab5e4c7d825d4451af3a60e2a04011`
- Upstream path: `xlsxwriter/test/comparison/xlsx_files/macro04.xlsm`
- SHA-256: `d49e30414b59e66446689d77119fa5b9f4f99fa86dbcade003f4d3fe1b8e225d`
- License: BSD-2-Clause

The upstream comparison test documents this as an Excel-created reference workbook for XlsxWriter's `add_signed_vba_project()` behavior. The fixture contains a signed VBA project. Treat it as untrusted active content: do not open it manually with macros enabled. The workbook test harness forces macro execution off and never modifies the source.

The fixture is excluded from the published npm package because `tests/` is not in the package's `files` list.

## Upstream license

BSD 2-Clause License

Copyright (c) 2013-2025, John McNamara <jmcnamara@cpan.org>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
