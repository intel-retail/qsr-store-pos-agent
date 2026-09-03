# EdgeMart Third Party Program File

This file contains the list of third party software ("third party programs") used by the EdgeMart application and its container images, together with their required notices and/or license terms. This third party software, even if included with the distribution of the EdgeMart software, is governed by separate license terms, including without limitation, third party license terms and open source software license terms. These separate license terms govern your use of the third party programs as set forth below.

Third party programs and their corresponding required notices and/or license terms are listed below, grouped by license.

---

## 1. MIT License

- node:20-alpine (backend/Dockerfile, frontend/Dockerfile build stage) — hub.docker.com/_/node
- @modelcontextprotocol/sdk ^1.0.0 (backend/Dockerfile) — npmjs.com
- cors ^2.8.5 (backend/Dockerfile) — npmjs.com
- express ^4.18.2 (backend/Dockerfile) — npmjs.com
- express-rate-limit ^7.1.4 (backend/Dockerfile) — npmjs.com
- helmet ^7.1.0 (backend/Dockerfile) — npmjs.com
- mqtt ^5.3.0 (backend/Dockerfile) — npmjs.com
- pg ^8.11.3 (backend/Dockerfile) — npmjs.com
- uuid ^9.0.0 (backend/Dockerfile) — npmjs.com
- nodemon ^3.0.2 (backend/Dockerfile, dev dependency – not installed in production image) — npmjs.com
- @angular/animations ^17.0.0 (frontend/Dockerfile build stage) — npmjs.com
- @angular/cdk ^17.0.0 (frontend/Dockerfile build stage) — npmjs.com
- @angular/common ^17.0.0 (frontend/Dockerfile build stage) — npmjs.com
- @angular/compiler ^17.0.0 (frontend/Dockerfile build stage) — npmjs.com
- @angular/core ^17.0.0 (frontend/Dockerfile build stage) — npmjs.com
- @angular/forms ^17.0.0 (frontend/Dockerfile build stage) — npmjs.com
- @angular/material ^17.0.0 (frontend/Dockerfile build stage) — npmjs.com
- @angular/platform-browser ^17.0.0 (frontend/Dockerfile build stage) — npmjs.com
- @angular/platform-browser-dynamic ^17.0.0 (frontend/Dockerfile build stage) — npmjs.com
- @angular/router ^17.0.0 (frontend/Dockerfile build stage) — npmjs.com
- three ^0.159.0 (frontend/Dockerfile build stage) — npmjs.com
- zone.js ~0.14.0 (frontend/Dockerfile build stage) — npmjs.com
- @angular-devkit/build-angular ^17.0.0 (frontend/Dockerfile build stage, build-time only) — npmjs.com
- @angular/cli ^21.2.11 (frontend/Dockerfile build stage, build-time only) — npmjs.com
- @angular/compiler-cli ^17.0.0 (frontend/Dockerfile build stage, build-time only) — npmjs.com
- @types/three ^0.159.0 (frontend/Dockerfile build stage, build-time only) — npmjs.com
- musl-dev (qmmd/Dockerfile build stage) — Alpine Linux APK (pkgs.alpinelinux.org)
- tini (qmmd/Dockerfile runtime stage) — Alpine Linux APK (pkgs.alpinelinux.org)

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

---

## 2. Apache License, Version 2.0

- rxjs ~7.8.0 (frontend/Dockerfile build stage) — npmjs.com
- typescript ~5.2.0 (frontend/Dockerfile build stage, build-time only) — npmjs.com
- Hermes Gateway (external, host runtime) — github.com/NousResearch/hermes-agent
- Qwen/Qwen3-8B (external, host runtime) — huggingface.co/Qwen/Qwen3-8B

```
Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction, and distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by the copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all other entities that control, are controlled by, or are under common control with that entity. For the purposes of this definition, "control" means (i) the power, direct or indirect, to cause the direction or management of such entity, whether by contract or otherwise, or (ii) ownership of fifty percent (50%) or more of the outstanding shares, or (iii) beneficial ownership of such entity.

"You" (or "Your") shall mean an individual or Legal Entity exercising permissions granted by this License.

"Source" form shall mean the preferred form for making modifications, including but not limited to software source code, documentation source, and configuration files.

"Object" form shall mean any form resulting from mechanical transformation or translation of a Source form, including but not limited to compiled object code, generated documentation, and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or Object form, made available under the License, as indicated by a copyright notice that is included in or attached to the work (an example is provided in the Appendix below).

"Derivative Works" shall mean any work, whether in Source or Object form, that is based on (or derived from) the Work and for which the editorial revisions, annotations, elaborations, or other modifications represent, as a whole, an original work of authorship. For the purposes of this License, Derivative Works shall not include works that remain separable from, or merely link (or bind by name) to the interfaces of, the Work and Derivative Works thereof.

"Contribution" shall mean any work of authorship, including the original version of the Work and any modifications or additions to that Work or Derivative Works thereof, that is intentionally submitted to Licensor for inclusion in the Work by the copyright owner or by an individual or Legal Entity authorized to submit on behalf of the copyright owner. For the purposes of this definition, "submitted" means any form of electronic, verbal, or written communication sent to the Licensor or its representatives, including but not limited to communication on electronic mailing lists, source code control systems, and issue tracking systems that are managed by, or on behalf of, the Licensor for the purpose of discussing and improving the Work, but excluding communication that is conspicuously marked or otherwise designated in writing by the copyright owner as "Not a Contribution."

"Contributor" shall mean Licensor and any individual or Legal Entity on behalf of whom a Contribution has been received by Licensor and subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare Derivative Works of, publicly display, publicly perform, sublicense, and distribute the Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of this License, each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this section) patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work, where such license applies only to those patent claims licensable by such Contributor that are necessarily infringed by their Contribution(s) alone or by combination of their Contribution(s) with the Work to which such Contribution(s) was submitted. If You institute patent litigation against any entity (including a cross-claim or counterclaim in a lawsuit) alleging that the Work or a Contribution incorporated within the Work constitutes direct or contributory patent infringement, then any patent licenses granted to You under this License for that Work shall terminate as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the Work or Derivative Works thereof in any medium, with or without modifications, and in Source or Object form, provided that You meet the following conditions:

(a) You must give any other recipients of the Work or Derivative Works a copy of this License; and

(b) You must cause any modified files to carry prominent notices stating that You changed the files; and

(c) You must retain, in the Source form of any Derivative Works that You distribute, all copyright, patent, trademark, and attribution notices from the Source form of the Work, excluding those notices that do not pertain to any part of the Derivative Works; and

(d) If the Work includes a "NOTICE" text file as part of its distribution, then any Derivative Works that You distribute must include a readable copy of the attribution notices contained within such NOTICE file, excluding those notices that do not pertain to any part of the Derivative Works, in at least one of the following places: within a NOTICE text file distributed as part of the Derivative Works; within the Source form or documentation, if provided along with the Derivative Works; or, within a display generated by the Derivative Works, if and wherever such third-party notices normally appear. The contents of the NOTICE file are for informational purposes only and do not modify the License. You may add Your own attribution notices within Derivative Works that You distribute, alongside or as an addendum to the NOTICE text from the Work, provided that such additional attribution notices cannot be construed as modifying the License.

You may add Your own copyright statement to Your modifications and may provide additional or different license terms and conditions for use, reproduction, or distribution of Your modifications, or for any such Derivative Works as a whole, provided Your use, reproduction, and distribution of the Work otherwise complies with the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise, any Contribution intentionally submitted for inclusion in the Work by You to the Licensor shall be under the terms and conditions of this License, without any additional terms or conditions. Notwithstanding the above, nothing herein shall supersede or modify the terms of any separate license agreement you may have executed with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade names, trademarks, service marks, or product names of the Licensor, except as required for reasonable and customary use in describing the origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or agreed to in writing, Licensor provides the Work (and each Contributor provides its Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for determining the appropriateness of using or redistributing the Work and assume any risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory, whether in tort (including negligence), contract, or otherwise, unless required by applicable law (such as deliberate and grossly negligent acts) or agreed to in writing, shall any Contributor be liable to You for damages, including any direct, indirect, special, incidental, or consequential damages of any character arising as a result of this License or out of the use or inability to use the Work (including but not limited to damages for loss of goodwill, work stoppage, computer failure or malfunction, or any and all other commercial damages or losses), even if such Contributor has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing the Work or Derivative Works thereof, You may choose to offer, and charge a fee for, acceptance of support, warranty, indemnity, or other liability obligations and/or rights consistent with this License. However, in accepting such obligations, You may act only on Your own behalf and on Your sole responsibility, not on behalf of any other Contributor, and only if You agree to indemnify, defend, and hold each Contributor harmless for any liability incurred by, or claims asserted against, such Contributor by reason of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS
```

---

## 3. BSD 2-Clause License

- dotenv ^16.3.1 (backend/Dockerfile) — npmjs.com
- nginx:alpine (frontend/Dockerfile serve stage) — hub.docker.com/_/nginx

```
BSD 2-Clause License

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## 4. BSD Zero Clause License

- tslib ^2.6.0 (frontend/Dockerfile build stage) — npmjs.com

```
BSD Zero Clause License

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

---

## 5. GNU General Public License, Version 2.0

- pkgconfig (qmmd/Dockerfile build stage) — Alpine Linux APK (pkgs.alpinelinux.org)

```
Copyright (C) 1989, 1991 Free Software Foundation, Inc.
51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA

Everyone is permitted to copy and distribute verbatim copies of this license document, but changing it is not allowed.

Preamble

The licenses for most software are designed to take away your freedom to share and change it. By contrast, the GNU General Public License is intended to guarantee your freedom to share and change free software--to make sure the software is free for all its users. This General Public License applies to most of the Free Software Foundation's software and to any other program whose authors commit to using it. You can apply it to your programs, too.

When we speak of free software, we are referring to freedom, not price. Our General Public Licenses are designed to make sure that you have the freedom to distribute copies of free software (and charge for this service if you wish), that you receive source code or can get it if you want it, that you can change the software or use pieces of it in new free programs; and that you know you can do these things.

To protect your rights, we need to make restrictions that forbid anyone to deny you these rights or to ask you to surrender the rights. These restrictions translate to certain responsibilities for you if you distribute copies of the software, or if you modify it.

TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION

0. This License applies to any program or other work which contains a notice placed by the copyright holder saying it may be distributed under the terms of this General Public License. The "Program", below, refers to any such program or work, and a "work based on the Program" means either the Program or any derivative work under copyright law. Each licensee is addressed as "you".

1. You may copy and distribute verbatim copies of the Program's source code as you receive it, in any medium, provided that you conspicuously and appropriately publish on each copy an appropriate copyright notice and disclaimer of warranty; keep intact all the notices that refer to this License and to the absence of any warranty; and give any other recipients of the Program a copy of this License along with the Program.

2. You may modify your copy or copies of the Program or any portion of it, thus forming a work based on the Program, and copy and distribute such modifications or work under the terms of Section 1 above, provided that you also meet all of these conditions: (a) cause the modified files to carry prominent notices stating that you changed the files and the date of any change; (b) cause any work that you distribute or publish, that in whole or in part contains or is derived from the Program, to be licensed as a whole at no charge to all third parties under the terms of this License; (c) if the modified program normally reads commands interactively when run, cause it to print an announcement including an appropriate copyright notice and a notice that there is no warranty.

3. You may copy and distribute the Program (or a work based on it, under Section 2) in object code or executable form under the terms of Sections 1 and 2 above provided that you also do one of the following: (a) accompany it with the complete corresponding machine-readable source code; (b) accompany it with a written offer, valid for at least three years, to give any third party a complete machine-readable copy of the corresponding source code; (c) accompany it with the information you received as to the offer to distribute corresponding source code (for noncommercial distribution only).

4. You may not copy, modify, sublicense, or distribute the Program except as expressly provided under this License. Any attempt otherwise to copy, modify, sublicense or distribute the Program is void, and will automatically terminate your rights under this License.

5. You are not required to accept this License, since you have not signed it. However, nothing else grants you permission to modify or distribute the Program or its derivative works. By modifying or distributing the Program you indicate your acceptance of this License to do so.

6. Each time you redistribute the Program, the recipient automatically receives a license from the original licensor to copy, distribute or modify the Program subject to these terms and conditions. You may not impose any further restrictions on the recipients' exercise of the rights granted herein.

7. If, as a consequence of a court judgment or allegation of patent infringement or for any other reason, conditions are imposed on you that contradict the conditions of this License, they do not excuse you from the conditions of this License.

8. If the distribution and/or use of the Program is restricted in certain countries either by patents or by copyrighted interfaces, the original copyright holder who places the Program under this License may add an explicit geographical distribution limitation.

9. The Free Software Foundation may publish revised and/or new versions of the General Public License from time to time. Each version is given a distinguishing version number.

10. If you wish to incorporate parts of the Program into other free programs whose distribution conditions are different, write to the author to ask for permission.

NO WARRANTY

11. BECAUSE THE PROGRAM IS LICENSED FREE OF CHARGE, THERE IS NO WARRANTY FOR THE PROGRAM, TO THE EXTENT PERMITTED BY APPLICABLE LAW. EXCEPT WHEN OTHERWISE STATED IN WRITING THE COPYRIGHT HOLDERS AND/OR OTHER PARTIES PROVIDE THE PROGRAM "AS IS" WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. THE ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE OF THE PROGRAM IS WITH YOU. SHOULD THE PROGRAM PROVE DEFECTIVE, YOU ASSUME THE COST OF ALL NECESSARY SERVICING, REPAIR OR CORRECTION.

12. IN NO EVENT UNLESS REQUIRED BY APPLICABLE LAW OR AGREED TO IN WRITING WILL ANY COPYRIGHT HOLDER, OR ANY OTHER PARTY WHO MAY MODIFY AND/OR REDISTRIBUTE THE PROGRAM AS PERMITTED ABOVE, BE LIABLE TO YOU FOR DAMAGES, INCLUDING ANY GENERAL, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF THE USE OR INABILITY TO USE THE PROGRAM, EVEN IF SUCH HOLDER OR OTHER PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

END OF TERMS AND CONDITIONS
```

---

## 6. GNU General Public License, Version 2.0, with the GCC Runtime Library Exception

- libgcc (qmmd/Dockerfile runtime stage) — Alpine Linux APK (pkgs.alpinelinux.org)

This component is licensed under the GNU General Public License, Version 2.0 (see Section 5 above for full text), together with the following additional permission:

```
GCC RUNTIME LIBRARY EXCEPTION
Version 3.1, 31 March 2009
Copyright (C) 2009 Free Software Foundation, Inc.

Everyone is permitted to copy and distribute verbatim copies of this license document, but changing it is not allowed.

This GCC Runtime Library Exception ("Exception") is an additional permission under section 7 of the GNU General Public License, version 3 ("GPLv3"). It applies to a given file (the "Runtime Library") that bears a notice placed by the copyright holder of the file stating that the file is governed by GPLv3 along with this Exception.

When you use GCC to compile a program, GCC may combine portions of certain GCC header files and runtime libraries with the compiled program. GCC may also convert a copy of this Runtime Library into object code as part of a program compiled by GCC. In these cases, the Runtime Library does not by itself cause the resulting program, library, or object code to be covered by GPLv3, unless the combination is done to circumvent the terms of that license with respect to the program. If this occurs, then the Exception also applies to the combination and, as a special exception, permits the copyright holders of the Runtime Library to use, distribute, or license the combined work under terms of their choosing, consistent with the licensing of the Independent Modules.
```

---

## 7. GNU Lesser General Public License, Version 2.1

- eudev-dev (qmmd/Dockerfile build stage) — Alpine Linux APK (pkgs.alpinelinux.org)
- eudev-libs (qmmd/Dockerfile runtime stage) — Alpine Linux APK (pkgs.alpinelinux.org)

```
Copyright (C) 1991, 1999 Free Software Foundation, Inc. 59 Temple Place, Suite 330, Boston, MA 02111-1307 USA
Everyone is permitted to copy and distribute verbatim copies of this license document, but changing it is not allowed.

Preamble

This license, the Lesser General Public License, applies to some specially designated software packages--typically libraries. When we speak of free software, we are referring to freedom of use, not price. Our General Public Licenses are designed to make sure that you have the freedom to distribute copies of free software, that you receive source code or can get it if you want it, that you can change the software and use pieces of it in new free programs.

TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION

0. This License Agreement applies to any software library or other program which contains a notice placed by the copyright holder or other authorized party saying it may be distributed under the terms of this Lesser General Public License. Each licensee is addressed as "you".

1. You may copy and distribute verbatim copies of the Library's complete source code as you receive it, in any medium, provided that you conspicuously and appropriately publish on each copy an appropriate copyright notice and disclaimer of warranty; keep intact all the notices that refer to this License and to the absence of any warranty; and distribute a copy of this License along with the Library.

2. You may modify your copy or copies of the Library, thus forming a work based on the Library, and copy and distribute such modifications provided that: (a) the modified work must itself be a software library; (b) files modified must carry prominent notices stating the changes made; (c) the whole of the work must be licensed at no charge to all third parties under the terms of this License; (d) if a facility in the modified Library refers to a function or table of data to be supplied by an application, you must ensure the facility still operates if the application does not supply it.

3. You may opt to apply the terms of the ordinary GNU General Public License instead of this License to a given copy of the Library.

4. You may copy and distribute the Library (or a portion or derivative of it) in object code or executable form under the terms of Sections 1 and 2 above provided that you accompany it with the complete corresponding machine-readable source code.

5. A program that contains no derivative of any portion of the Library, but is designed to work with the Library by being compiled or linked with it, is called a "work that uses the Library". Such a work, in isolation, is not a derivative work of the Library.

6. As an exception to the Sections above, you may combine or link a "work that uses the Library" with the Library to produce a work containing portions of the Library, and distribute that work under terms of your choice, provided that the terms permit modification for the customer's own use and reverse engineering for debugging, and that you give prominent notice that the Library is used in it and provide a copy of this License, along with one of: (a) complete source code for the Library and the work; (b) use of a suitable shared library mechanism; (c) a written offer to supply the materials in (a); (d) equivalent access; (e) verification the user already has these materials.

7. You may place library facilities that are a work based on the Library side-by-side in a single library together with other library facilities, provided you accompany the combined library with a copy of the same work based on the Library, uncombined, and give notice of the fact that part of it is a work based on the Library.

8. You may not copy, modify, sublicense, link with, or distribute the Library except as expressly provided under this License. Any attempt otherwise is void and will automatically terminate your rights under this License.

9-14. [Acceptance, automatic recipient licensing, patent/court order conditions, geographical limitation, and revised versions provisions apply as in the standard LGPL 2.1 text.]

NO WARRANTY

15. BECAUSE THE LIBRARY IS LICENSED FREE OF CHARGE, THERE IS NO WARRANTY FOR THE LIBRARY, TO THE EXTENT PERMITTED BY APPLICABLE LAW. EXCEPT WHEN OTHERWISE STATED IN WRITING THE COPYRIGHT HOLDERS AND/OR OTHER PARTIES PROVIDE THE LIBRARY "AS IS" WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. THE ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE OF THE LIBRARY IS WITH YOU.

16. IN NO EVENT UNLESS REQUIRED BY APPLICABLE LAW OR AGREED TO IN WRITING WILL ANY COPYRIGHT HOLDER, OR ANY OTHER PARTY WHO MAY MODIFY AND/OR REDISTRIBUTE THE LIBRARY AS PERMITTED ABOVE, BE LIABLE TO YOU FOR DAMAGES, INCLUDING ANY GENERAL, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF THE USE OR INABILITY TO USE THE LIBRARY, EVEN IF SUCH HOLDER OR OTHER PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

END OF TERMS AND CONDITIONS
```

---

## 8. PostgreSQL License

- postgres:16-alpine (pos-postgres container) — hub.docker.com/_/postgres

```
PostgreSQL License

Copyright (c) 1996-2026, PostgreSQL Global Development Group
Portions Copyright (c) 1994, The Regents of the University of California

Permission to use, copy, modify, and distribute this software and its documentation for any purpose, without fee, and without a written agreement is hereby granted, provided that the above copyright notice and this paragraph and the following two paragraphs appear in all copies.

IN NO EVENT SHALL THE UNIVERSITY OF CALIFORNIA BE LIABLE TO ANY PARTY FOR DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, INCLUDING LOST PROFITS, ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS DOCUMENTATION, EVEN IF THE UNIVERSITY OF CALIFORNIA HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

THE UNIVERSITY OF CALIFORNIA SPECIFICALLY DISCLAIMS ANY WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. THE SOFTWARE PROVIDED HEREUNDER IS ON AN "AS IS" BASIS, AND THE UNIVERSITY OF CALIFORNIA HAS NO OBLIGATIONS TO PROVIDE MAINTENANCE, SUPPORT, UPDATES, ENHANCEMENTS, OR MODIFICATIONS.
```

---

## 9. Eclipse Public License 2.0 / Eclipse Distribution License 1.0 (dual-licensed)

- eclipse-mosquitto:2 (pos-mqtt container) — hub.docker.com/_/eclipse-mosquitto

```
Eclipse Public License - v 2.0

THE ACCOMPANYING PROGRAM IS PROVIDED UNDER THE TERMS OF THIS ECLIPSE PUBLIC LICENSE ("AGREEMENT"). ANY USE, REPRODUCTION OR DISTRIBUTION OF THE PROGRAM CONSTITUTES RECIPIENT'S ACCEPTANCE OF THIS AGREEMENT.

1. DEFINITIONS: "Program" means the Contributions Distributed in accordance with this Agreement. "Contributor" means any person or entity that Distributes the Program. "Licensed Patents" mean patent claims licensable by a Contributor which are necessarily infringed by the use or sale of its Contribution. "Recipient" means anyone who receives the Program under this Agreement.

2. GRANT OF RIGHTS: Each Contributor grants Recipient a non-exclusive, worldwide, royalty-free copyright license to reproduce, prepare Derivative Works of, publicly display, publicly perform, Distribute and sublicense the Contribution, and a corresponding patent license under Licensed Patents.

3. REQUIREMENTS: A Contributor distributing the Program must make it available as Source Code under this Agreement or a compatible license that disclaims warranties and liabilities on behalf of all Contributors, and must not remove existing copyright, patent, trademark, or attribution notices.

4. COMMERCIAL DISTRIBUTION: Commercial distributors who include the Program in a commercial product offering agree to defend and indemnify other Contributors against losses arising from the commercial distributor's own acts or omissions.

5. NO WARRANTY: EXCEPT AS EXPRESSLY SET FORTH IN THIS AGREEMENT, THE PROGRAM IS PROVIDED ON AN "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, EITHER EXPRESS OR IMPLIED INCLUDING, WITHOUT LIMITATION, ANY WARRANTIES OR CONDITIONS OF TITLE, NON-INFRINGEMENT, MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.

6. DISCLAIMER OF LIABILITY: EXCEPT AS EXPRESSLY SET FORTH IN THIS AGREEMENT, NEITHER RECIPIENT NOR ANY CONTRIBUTORS SHALL HAVE ANY LIABILITY FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES, HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, ARISING IN ANY WAY OUT OF THE USE OR DISTRIBUTION OF THE PROGRAM.

7. GENERAL: If Recipient institutes patent litigation against any entity alleging that the Program infringes such Recipient's patents, then such Recipient's rights granted under Section 2(b) shall terminate as of the date such litigation is filed. The Eclipse Foundation is the Agreement Steward and may publish new versions of this Agreement.

Full text: https://www.eclipse.org/legal/epl-2.0/
```

**Eclipse Distribution License - v 1.0** (alternative/Secondary License, SPDX: `BSD-3-Clause`)

```
Copyright (c) 2007, Eclipse Foundation, Inc. and its licensors.
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
- Neither the name of the Eclipse Foundation, Inc. nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## 10. MIT License OR Apache License 2.0 (dual-licensed; recipient may choose either license)

- rust:1-alpine (qmmd/Dockerfile build stage) — hub.docker.com/_/rust
- qmmd (cargo install) (qmmd/Dockerfile build stage) — crates.io/crates/qmmd

See the full MIT License text in Section 1 above and the full Apache License, Version 2.0 text in Section 2 above. Either license may be selected at the recipient's option.

---

## 11. Software released under multiple licenses ("MIT / various")

- alpine:3.20 (qmmd/Dockerfile runtime stage) — hub.docker.com/_/alpine

The Alpine Linux base image is a distribution comprised of many independent packages (including musl libc, BusyBox, and apk-tools), each carrying its own license (predominantly MIT, with some BSD and GPL-licensed components). No single license applies to the image as a whole. Refer to [pkgs.alpinelinux.org](https://pkgs.alpinelinux.org) for the license of each constituent package.

---

## 12. Proprietary software (free to use)

- LM Studio (external, host runtime) — lmstudio.ai

LM Studio is proprietary software distributed free of charge by Element Labs, Inc. Its use is governed by the LM Studio End User License Agreement, available at [lmstudio.ai/eula](https://lmstudio.ai/eula), and is not distributed as part of the EdgeMart software.

---

## Notes

- This file was generated from `Multi-Container Dependencies.xlsx` (Container List and dependency sheets).
- Components marked "Distributed by you? NO" in the source spreadsheet are consumed as build-time or run-time dependencies (npm/cargo/apk packages, base images, or external services) and are not redistributed as part of this software's own source code.
- Where the source spreadsheet listed only an SPDX-style license identifier without a specific copyright holder/year, the canonical published license text is reproduced above without a fabricated copyright line; refer to each component's own repository/package registry entry for its specific copyright notice.
