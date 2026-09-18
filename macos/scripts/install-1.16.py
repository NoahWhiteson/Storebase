#!/usr/bin/env python3
"""Install Storebase 1.16 onto a 2c173c3 / 1.13 tree. Run from ~/Storebase."""
from pathlib import Path
import sys, zlib, base64

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
stub = root / "macos/Storebase/CloudStub.swift"
if not stub.exists():
    sys.exit(f"Run this from ~/Storebase (missing {stub})")

FILES = {
    'macos/Storebase/CloudStub.swift': (
        'c-rkfYjfPlao_nXhFdNb5U-%s`Rw>Mq8N#ke2R|}BT7D3Nh}t)J4?dE0xLX3F*2+CBl0DG&%Y$yJ'
        '@3H)yL{-Jr1IfTTwoqOJw5%NMz&m)Rl}aGR)5TztxWvdPpiwUP`_T5Z81-qtSq*+R#o;nZ8%$GMV'
        'hl&p4K({13Z|re{GA|IiFqdIXmLe{xs+8>lS0GN6s6zY#aWC?XcHJKb5nKD2CSy=*H@+V)o?S)98'
        'eqmh-DAi(>ZhDSIdWPopr=H_25$#^!v%EA~~sXbbU*UDL~oH*HnWaMb*I>w0U87wwYm<z+iRYT8p'
        '8w{BozGXm~Q+BDVcbjbn0QMy_sbyHUSG_85E%F`J?FY`ICMsBB^pQW>_7hf9eq&s+xn)K|a^pxk='
        '=E!cNaAUPCSG@Q+YtH}3udw;7TqXcZ&Xb=~MDP)>K4&vtCvRlCo?+UWSMSoZx--m@Hz{mpIz72K*'
        'nidV<$Kw(XCUag<VDjzjvVG?RseSPMC+chF3)+zUsmOE?Px!%mH-yvvTA1yJAhVGwpSYBV(fETu~'
        'pifPuWpZWyP6(SZDtMRQalCe)qk3))1+BEeqIl^>CMH#Q~qDKH_x^2Vm;bwi>lPowE0Df6`B8DI5'
        'j&QN@>KVD2E4MY^ib%jRg{-9eKf(E9-5u73Hc&3N-Jn_bk@t-BPx6KD8)hfXdX53dQ$BvuSVeUOV'
        'kh8`b|ds<&|zJi58lSP`>JlqOsb`FhTNI=cdaOYR^3VvYIBi=j_NP9Ze0S@Q;qRDaums$(t&?M77'
        'pn1+`$k%>^-u0$a0c2-=9n85WzJ_ESrEnUnoTz~q8dCADB%f?S+pz#j|1+{57^ULroc@lWR}B13v'
        'NF>~aJaKJt>!p#g5(bzh!?m?z#%VrH3J4S2WGglV{s@B`(nl`vfLR7;lLvZAT-t0E@Cf@W@Q26Hu'
        'amulo2?6W5@^8^WTo%yx!-t68J$BCv*BM!c`}L@Wq%`GNrj<MWQy+vYJ@*%Pi+05FFG!FUwqF?j{'
        'TW>tEGQ$W?6bAn4)AUjTn?U<@<$n58)g7a)T<ovU3R7TCp`fb-R0tL2?NKuBQ^9Dv94Ga>ecV~w}'
        '~a^&p?9X&asBrOfPwF>r>{r>R}--Y{Gu!RxyysfVy94U7gua6XDF$oHGm`3rE1nDWwiW;8%YLX!1'
        'B&^|@=-+GHD}DHN^9WxG(cS?FPrkERH4t2Zr}G`KNZ2lrm??_hA11K`4e=tTrG10ZfTve;V7EkdF'
        'bYA{S%zjZAMiD@mVIKNNjgWiX3rN%D0+adIH?pziUGj_a7dS>5Jqhl(?Kl#7V9}H3*_i7OH1nZw5'
        'ie=B9m}f$FhstjtTVF@}(pJ9Fm?4Eny$H;k`kxS!+Mwy2++6dmLO6@sHf08lQM?LLqAA&cfgXdfV'
        'aAGtjzOvG*>-B=n(fkq7}ck08hL#ZyU_J%i|82`VL@`Jd9f<<X+7KrNfnvSSyiN}{jD>d$H6vd;U'
        '(>mAV9L&Be0UN;9YLzSgDKp{Y{rGkR^1f^!LTxA@d(K>brmx_}B(y#-|3hJk~Ua)gpl9Aj&=9bpl'
        '1OT;LKYs_*4z?3@s1u<r;-373jCQK!i;`W6@#8YH!rI(-X?>x=fa6kHKLq|8F%zuBoinTDZ^7KHI'
        'jsRsgnGcz%QOR7Wnm6lOMFdjw6O;d*tVR~9tbFTTN8}XbgZ{PU|I1TI*DNc4>Qnq3G-H~YyI~%sN'
        'Bu$+!^E1BO(VINZ1i}3OoLgFJQ>#U&z`5lF0I$fmVH4vy>HOlP$8Duy_5LuKW3+0=UZwHT;r*=s4'
        'LFL?;4Bh`Q=Er~!czqlGveXz(49%%y$N1Jgh8df03+8Gs2?ga(YSRYPhHJiV2~gq^jO1PQCn6=`Z'
        'c8GFJWPpqATb6;H@+S{+8l7GZo?yd+<v1J~qIUE^7+bkq5Dspn+UABD_25HG7**0=tOC~nRxV+V%'
        '*swu0TwGG0IQxWV5@XKk3E?8E(OclQ`z5wPa6u%HgS1G`cm>A5B5m^~L3)1iC99hnbX<#~J$?3C6'
        'JJ&=N?$A1F9o-R*Vt-TXq3CV>sYFo5ZaAK7PQ-<9dN@Ju*9ogfQ&M|!y+<!@L*KDE?dAVQA{mK2E'
        '_@j7!7*(eH`mwH2*~HlNs~L4r%CPxuSsL9{>q`2^tCX0|qDeL8M0(NTX3A;svy`V$EV7#NT7-nZW'
        '<YLqgvn6USz<ScxLL{j6RgpZ@ojw>&w^%Tv&lKb3%>qy>`Cnk&$y@i0DH0MCx*U<&710bnFWc?tT'
        '=uh}H|&2Qrli}Zy=msX+c;{gV_^i=@42r18ySHz4UW6gPmf&%m!XmJbnNKUmp1zTZ=2>~_qnn6Lc'
        'jaluXDX*F+pvg(A&f*Q*5*9r(3ZxU1MiZ7KPuO=8n<*I4k9tN@=bW#iA}va7bp3X6GMUhSh6%znd'
        'WF$fw%u>w;o?p!o?dtoS1$n2Yr(Hvz>blo2e%nAa825D;VA3nCde%59VuC3m%D7NqV@2e10;O_41'
        'LT<vPquS#QgTk<qGT;b559o5WObRDsV0*W97`$EMY7inc<N;Y*}&DG3a6N4}tD+JqZg@JbQNd>P1'
        'zRRfO}lHG!}MyB_#D0P(s6mdLbb3lt6u2kmrq1#qDQXo?86p}_e$iU8p?6nyHgoYdJxi){*`ASCH'
        'Il@r9AI6Cb>LPCAT6$qKBXi&<68q~TKN>pCC?>jVVF^3F&d*bLE0L4F>0jiR!#py(}BO-<)RK_te'
        '&0Sc9V^5HK2ylrk<JoHU7OlM{Pw3HDyh(5-boO9d+KC<HQ&BB_qM}jF8$>}3Y<14bOzZRO=|x32*'
        'x2vilo!0{Jk7IZ);zyzczwvLBjOBES^NxYwE{r=io;Y%$ht8F8rsY1;_rX^FEI{nc`yCV@{E(B3q'
        '$YG-?U7?$dq~~Fas@7{*)p_bPFw$oD$IRyDiJwDr(?TujYOGFW2aA=x%b#&$8m3>>mvrZUnMH79^'
        '-1P6J4;RbHmT*)HsjF57f{3KpP--wSJ!{i_BU1w$87Ud%O|*?ek^6$eZwAx1)K;S5-R!}np^aIP!'
        'j%@j*{Tb4}(_Rb|3K;&WriIrJR$v!vcA+2Y*0*qU|G1MgD4-WF8(Z}fh`&awWpl!3cbY?#M*u$Ym'
        '@s=wHB{9s)%K|YjxwU4gxHnS-21VN(#*mw3&h|avzg^7%89iGtrfH}4<Wuoacylb5fwJ~PdnNsU7'
        '_EEO2n~#OhknzF$H0JQ7wrlky(a1<nOd$I8CN=%MClptBm=@zqCm&tT&dkpP)>US33o$x)LM|_{B'
        'ksp|JzoVYI0d+Aka}d>%Br0=pUBgwn#z9ZtIjP8E(lZan7j?{)u93K%z6IJ-VJ$l8-UIdL@Fh%H3'
        'qYkpbJtLkTg*^Rzf4`$lOtTYV%cM|^$sb6H)0ia!Hw>^ueL3j(I$xG_gpHEhG47&4MW+cP?{v!kE'
        'av$WW+N;trC;Z}-l&%}92LHiH^;495fUY6BfTUD@L40`MC3kvL`L-~XDkiyyOV;B3pzG%wTC?0Rr'
        'TJnW@<My)_cVyG{hoJnmpe(88$7Wf}Fix}<yuiE;FBU8Ge}NI?H3~OhJBkPrXRU&Ti)CU$g*N{dH'
        'l-LPaZLP<=MpC-iic^%;D!&9)4L)^l^CiA9oR2+dVMDSQNcN^S(5kx-h|$Bcs6EgQ3vH*`vlEPM-'
        'g=<1=1zyBPQQ<2F3%epNEInV;OAIh+`FRYOF}pQC7@&MDJsU_F6B3iPLTB^9>JRxf#?N6c&spLrd'
        'WFOz@9BpSKt4)=^nA1n%d&$MkZ{DcX2{1Xyk)fq>a)tXME%K-BNPXaB?=Prm!!aT?Q^kkn-}OBNK'
        'BXg`Y{%5XAnxK3z+8hRlGqp}P}RxE*J$5zB-Cl-fJPz3J@9R_xAMSf)olFo1P8eQ-!(}*!4WT|nq'
        'LZNkm#6F1w%MXei<Sc;nTBb6HX?_BmOYij9&Q2n`O|l;BCWZX7JO|L=!E>OQ=vR|C!BG0EqQ>ZYl'
        'YQoR=0U<lDz}Pa>`7SxbKvtMWFvZuXjp%PHpLpVfgQ%&THJMrD4<gu=76dWmd3P*0SA`l(IY$3_U'
        'I{_(#kcmrRO}WL6gITEcuu6PmFcak{QkD*K;6mQm~7%0N$0Ol}VlCC{y)^w#l(a$Tx<^w#RK|8z~'
        '$5k!cn;<RG2kCK!ip+<?<9bWUOyS&`M}m`zAyhCHc<mgXmvzA%D1K6E$2<-EA|RJB!lg*ryaVbq<'
        'z&u`>F6V3_3%$^s8%Ix9vS0pD7`|d4c0(Ep8EFn6NP!Sh6(*{A3Hsvy#g{^{6VB;<nb>kfuv)<c|'
        'cYV;=8QK7m(YmB=W*^o;rSAWb>UPtVD(eWj?#*s0Rj<1<r0@*KO8QMZ`%J501E;zJtE&>-5ZD2~C'
        'n`X8xR8F@LD~%zzf*K|-B-9v!Yjsn%D$ic@H=N0?~3*fBKExagmEZ0=R+N~0W%lC?z&)vvk{R_xi'
        ')4g!b?=j0BlXmspBEO?k1hd!=iLjFC(*#{S_LBz2z?Qwmv@;qeUv3WjG7vuQ;J7>6jMwp<ca63SX'
        'hVAVE{XIPuF^lG>=p<{eM(HcmJgX6?n?@H(vya!2i@_GRoyhSL|iOTdOXtoS1P64@?AU(dj~Ulsd'
        ';Cj*hVCWOZb)NY$~zA3otiRrF1WFDxlwryaqSs;8Z%{t2H00}xVkJpqg18lv<S54OBYn<`ohR0~H'
        'ED8`ctU2fGAf2H%YK%V$k&}auk!!H@3>Ke^;yx|l8zl!g!MqI;1O~A&7#tJ$7<BP<7Hw%&<o}Xfe'
        'xuwhD;f~;kf^bS+$1-3icpHK8dyE-92LJoC^JVV5=&CF1ctn%5II?7;%bKDnWcj$?q{eO-IuP><G'
        'wTE#?P<_x<g{GclTn)jrz$;A8WivZeROO$i#YMxRPhtdun%>qW8)+pNoS{#}!lh4S}0e{xMo(Q^x'
        'U>eT+DU^%BxVkn!&GdRAp*6{vViP=M2=6N=bLt5?SAR6@Eh;%376>)vPy=k2QNELtReIMyuBy6d9'
        'zDP*><q)y-2z(V(991*ESrWbZqLw3cdT+G@;rJ)$7i0MkK(LctAa{&Mc?*0e~D#1c2D&erPC-co@'
        'ql8YIEhXvF6{kCMvW<R)j}t?)n1iU_Aw=rnW4pD2wRawWmS69%#|C`=?GyH$1^kVnP+`Kd<_aZax'
        'hqrouM-CkCdk7?Rch8zBfn@U_a)Chlij5WLg&=bb-Ss!YC(IT?^<9V`_Z+L=V}6&3s=g1EvDWYAm'
        'g6gYDz5nQL@<ow`w;rO?$1kew(i+?AOWr95DDi(=a&A-ORD;^)7C4K28+<O_e-1M@925m$9P{enZ'
        '!wVo3VlQG8=>kjvBV(is{7A)s&ESNo!PP}_C&HFwN=Q`)RR&yb#?+b&Txu_ImskuBkLu0Uq(Y#Fr'
        '*eRg_-EJX>(Q?`o4B=Q2pg9n}F2i|*Xzs;V88*YcLZ9R^SyP80>nXq(uW89&jEz=@SDl=PwOBZzU'
        '8IaJM{?)b1M0ONn*txf}Ch=$}xhR}qv{Awq!tVKPT({818BUvLIXMTlKi#R5>EvDzF<`n0PwSFy?'
        'm6+vyQ#7jzDgsvRxC!{_wZQ8m?#jWned$VW)$7y0`Htz6kdJzzRp@ZqfSB3!Gt21Az*3@lT5r>93'
        '?9bF{jDsS(2@W;s`rC?wo-(T0W_9|0hcu9aOoyFtwBgyOpaoxU5sD4ua|K3W;EK*UH485@B)X6R+'
        'ZexQ;3#w_b>=26{Os=R0|Jka}JfbN(eN7eIrLMt*2(G;))c#ITX*{vk=8(16FmD39embng&^(2gE'
        'T6yj4RcCpr)Eb5AQYog}Wez}A*d;sS;{xDHyWN*HZTi9fo&K{uw5637ogBwQLuddl)U;D;{4s}^*'
        'H;cSwSjQxX4bgGmnw`LAU$$9jk+$!`UgJ8-lDt<XuQ*EnE@kzN**3j3o&ueEO`Wdqf-R9R1ZKfXX'
        'YVPj9oj<y#yX7BSi#$Bh%StJa6cC&=*8^z4>ogmCV1&lYFR<32PhQ|PG<|zM43{weEoK+8Zpv`Je'
        '-z!myPS2<Yv34w}X@^u$9>BBe^sWBHv9#rZ{nWRC6Ui8yLVM7TL|(Yq^-wM_~geA0yc&9yxSl(f!'
        'aiT5<R8QS8lg3Gkz@GIc3ku5^m;UGg@(yI=R3Cu?qSg-c&}d3D40?r)itr4p#RZl$|rXZcrF19#J'
        '``co2c%8ruamVh?psbc-ZIFk2#sN@n1Si>-Q^$&W9)1s#PAkJ@-(qmHA33DoKhu)oL#oTuy^<|ES'
        '^Tz3^F55MnK89EAff1O_onRbao&qSIr>bwj-fd9?3c6r=+0WnMWdeB08ZhU9YSRW4uF=P0goz7P-'
        'GG*~ibRhDxKKl<13C>&?IEw5wRwj$$zSS3+81_kKI!z<BW!J)v^b0=MN3^I`GcF&K4vx;!{ZyO98'
        '%)KGukEV#_WSB@i%?+=%bX7@yI}PJP3{={4hCCyn9DqAH+x6*9T4Cy1qRXslgwZo$zBepYuY?X2('
        'M>T;ec1x_rEG#0cxKi27LEz4Q#!2iAU0dS*~%8$EgkTOd7v^&>5=keEjC4NXoxTjE`WHefh>`*~Z'
        ';vA7^+5S-HA!YJ=usKo}mTO{0;v&O10_pG=&wyuqg#3b2#G!4xC3bsf1I4Gx}V~CAZ;C6(ogCP{!'
        '1@luc>x*nfg*Hd>uDg2inOC^+BfJ-BT?GkeavoM-_JOI59Op>p3D6!T*eb$!uH9rxE2lg5OSEJXz'
        '*LG>sLtJ-g!4Z)O|!PjUJfT&iwsg|@xG|j1t+H^UK(!~uKx=N-Os~@HVGp8*?eB{x)u*+Ws4rg$x'
        'xd1jaFh+wfqFAPcf9jNB5L--%Gg`-?Ew9365lxj}yT!h;ZYM8{|&(K?8q70=eiA#+Q4cj4yX4je*'
        'h_UAf-7IU?0g{C%v-Lu!>*2%`(s1JZg|w_7*6tu7DGEUTZcnO7GtT|euZ`G5d-ExuZCK6kDf-i;K'
        '_0$WUXPbcnnUU$+eBp^@Or1wfZ)c_SoMb^k{3sL4I61`(P`HWO}k2DY32202)3I$ct0KeItl=UbG'
        'BLP)ihtBcA#w<{vh}JZOAiEZ5KOb3HZz53=l+a1IT8UIk#3@b}$FXy7*zg&7slTtzZFW|Gg#A$^9'
        '(eUy3EI(uv~($bts2hq!KXHxUF2nXG4DL7VYVFX2HyYXAqe)e?!0faS`>0tZ)~9<+a%3-yF4w@EZ'
        '5z0{pbvp6hb6d8lP&loY&T$C$u2z$z@qxnB}V9C&CY*9%o=%NC>gKLeYd?h}Osb<p3%BU`;W=s+_'
        '@A0GYsmN~y(%3ID=p;+#;lrBA(V>*`Sr!sbz4my40rKdsKhMOxhH(L;1`j~*V<|6k(&S2OziA^cy'
        'RIdgZmY|-Ozn60=Ck_z#>X`2-_fM(sdRHH)Xv;3Hn7Fe`-zK_N^4_%6(-c?&fLl<AXd>a*z76p<9'
        'E0Io;?|v(7wR5yEXu7O^+ZF{W1+rG;6Em8c`Q14lK3U}lPMkd~2=rv~*b5!GLz^;9_!x^efKJdTj'
        'G9#-|JzYP6siJ_h$RC+;O}Kwz2y|*O%Nbt6Yt6wpsFwEHW%;)x{5?9dD1qE-`iQcRF50%#*~8O@*'
        '$@7P`(>RJ&pZO*4~kE0(^wUyylmPlsJ%aw8&FR0>puYtDrYgM<;HWm5Oe2V1qBQtI7Jn(rh#`mPj'
        '92F;cS(8cN4fRXsS}YZdM#7w?psvu45=5a2l%>@t%5Vz(xo<0WGuPwrZ8nKR3Yg0HWRu!^Mgu>b{'
        'TAn;&&+;w3fTOt@2inu@AS4bJ(nzn|Gk79MP*m`T&_QnGmp%V`lWu~B!^0D9OdVrH@-L-9lS!99{'
        'QelK!ShJ>5-fC6THy=7qZwzn3*|t3da4HZC5i2uEjxdIM10|bls6?O{TEx2@*jyG0owj$xk{&$39'
        's!!^ahr`i&jk)-d(ZsZ8D+7^&b(FQ!uIGzD@3=XO3^sMYR9;DwVhW?>HR?7SS&7jeIz-ng|Xc+BY'
        '`7|lK-hB#C&BZV=Ce%*YDQdqg_nB%z7AdpJPa>QQNbdoM&_7y-JXki$xTNZ^4UtAtj&<bAVvOB|H'
        '4uAMv1TIv-%~jz!@ZYfV@`MvOL=$dL$}%Ae#3TwzeGEQE*vW-ZV(m^ue)<>!oF_G=R&{Nnno4n?P'
        '1d937wUVg;Qu_4E~Ejq4;gBRxP-@dxQ#txjj`#Q`W$&>ysEA)ls9BcEQN+z6jeNF#Mtj+b7=7uN;'
        'BH<UeHaGwBM8Lva>t3VSnd{bA(ids)#jraqcyWG7-R|NP+i-LKK|WLS%_S$k=X@3FX5XZ#Fg10S<'
        '!e7Qqf@w$d3xW0m{?yF!elx9MIn%+pW3wXzV0J~kluHDI-m0iT!3(+n92tmjyrX4eNdfJ01wpx4A'
        'kNmv$P`1#4D#*%C9CO@J+cT^atps@K9ZVRQYX2`==pfRFBdIC8+dI_okLg)=ocj2@H)84_yLru2p'
        'uw7vj1d?K`LTl9e*yEKyus*-flP1wK~dlsDS=dnL}~?l()k`G?l+6ev1zJ~K7Ec%|psP=Epe28)A'
        '@pbn!z4A?_d)s`Z?3TuPccj%<?-s^Q^?>^6%Ei+U^<po;1WU`USDght*Ai*8)_FcfUPkK*TQkxZ6'
        '7O8C8IWm5gQ3cAqU!23sRgSB1*C-@yo)cRdsQgR{N_lBqI-O!)kAL{*iFI2I+CH=y9(%%m(^n(fZ'
        'nlG6*QMZShz)#r-%N@%Cv_cPAidR*<;W1N#f=POY&d7l0cjFc1+4psL^kF!qWB<JDN`LSq)Q;s(S'
        'uwH{XBZdEjrU*15Di8QP@Wwq@KHf*kbM7Kl(&qDbi&7tPX3c8y7nYgDDL%#Qm6Ui_3n>*FZfaN55'
        '4CB()s7!in4gRe0Q<W3xIaH%6>nB0@H2Lf*k)Q4-4nz+zMKk6#Q^1l%`6lP$1mCND?I9(_}E-UJV'
        'uET(5R!GtYw(d#yKZc=qF%QRJ5pND2vE_Av%TUD6Cs)|R8j2?WNh%(a1oxY!Z?>J0dsBb*j554zV'
        'Y%1zraS`;>xlC_$(%0(OagtDN`K)Fze1#<<|L~ms{cr!tD6yC`tUe-2ZqzVDGTQ1E3FteZ-HSZEE'
        'xR5g5)Srv2l}u1_FnW2mXW^e&EMg>zqh^ptJYx49QOlJ-UkOvL+=WKIO#o~DhXDxlA_q0YIUH&M('
        'C4)Yf3`hx@exqIeexO^aTuFiuY^<>tg&XA^P>$+e!xr-;y`>lk6*>T*veoD+RdjtDAZ3r)w$EsnD'
        'QxN78m0eyKv<xsQXY?uH*@^CV(eXIB}0yH;_e8(+2mCMWQlRFoS$PnLmfUsMT_qp?SZuPhLM4&_b'
        'Gv#O_HwRPnyH9p{@c7>nf{sz~-`fh#=obFJSept}P)%hj%pi3{9@`G^?sZvt%m%1!Q@i4U;4nT=i'
        '!c6#jlkeN=?ecwcy7Y_s6h^<VQOw)@&aFw`?svl*W^p21Gs@bzg=<kbW`d?Ib@J+P>ZON^aT-S+9'
        '-e12Ox3u97Z3idM762`4<1^*a0pc7>WEU7(UVv0hC3|FA_H1Otf{ozfe$#J0nH(8*BT1Hwh#j8RG'
        'Ck6bQE6&YvhqNZx;wuYYcyZ(_o<MxbX8lWVs(Td!M(0@P$qT2Vro+F9g=a?}#cMPThcDlw;=l)DP'
        'mOw9g}HJka<_Jv-;~mMZ85Kh1^a$BN4@cZ&x(=a+cJC0S;9p2_b-MZcf8<MQUkXE=y5dZn4Y;n;y'
        'M0Bj!IT$OoFAF7R=N8)~l`3P@FRTc16yl$5&a|KU#qVP@sZVkhs^3x9_iAM3752<#VTau%qg60$r'
        'CX{(`UqgjHnOmgR!ACzf9Df*crwwLaH<~uyX?+wWrvWj0=@0Z#IJxwfWkoOQXeoWESjr^li{_vN*'
        '|#rnaXhAACq+FadW@l}*n%=i<nM0+PI+03nfd*GWkV*>cW;o9;e2a6ePtXwc+>*2haP)hjiYA*tb'
        'YjjgLv(%L?ZegSJGc^K%XP)gf11#c!yT4c!kk3J}3B}w@rf;wjQv@lt(hL0@iiIPfKL@h^#~XQ`S'
        'XEaF>jy*(!2sJfeW~rNNrZ1iVi^DK*|q>t*GZ)w`<|%xi;^m_PAlG<to6gVR`t`Z0(NCsW;G##Hw'
        ';P|cP`z`J(+p$+^(VAyk|B4yT6P+q<{{R{9PQmFUx6m|gd_4){_x*``pwzG;+^_FRdvVKSXrpTpA'
        'd@PqkxL&^&D=^mmVuT@(uRW|fl<O%z4op67s%|SW1%_i^&02*l>jUdXp4y*pw?42gZ}E3a7}`BMp'
        'SHjr-j^*pA00CTcwb6Bqv|p8>zxKU@w$W8kuV#4WEAYBS8%v9sx#`T2^16}Es0Vkl@|;XxtV2(v5'
        '}Z~WcwxEAUbLYSfwU96MqW;W3LhB7(=7c$SMDi+7lU4Y(X&#o;ziG+_}7=@Sg|l@XgVyKa22WxnR'
        ')(9hR_7DcA!K80u^b&gae`K)v3;_(Z_c`8I)0dZw(Of>G_xZmZGBNqu?(;Ga-~lM}N{cRKn7I9Au'
        'EG(M2SL0{xP`x#*{1=FSDix8zkiC<#U6hEThk=V(p+|jTpq_Speuxhd95A~FZ=loeQe@l(UHwPa8'
        'D6um+`hxB6gf^nmq!=y{A6)#CxD`dOfYW!8G60t>$c=q9>NdzzHf;x3sZ2ozjv702-k!+}vl(+rE'
        'nYLgZSKTxjBwbD=lCDt0j^`^)RNt63S$w7k`-OzhiZlGIY$EuS{+c?EEwXy0i!?xDF'
    ),
    'macos/Storebase/StorebaseApp.swift': (
        'c-oy<ZExE)5dQ98!FgXKz!TD~>jwduo91N=nlwe6wivP^prw<=g(5wYiklVz_G|XT_DgnrkwwdP2'
        'kb)<z8sIw-92|ag*8j53^`gZ-!L;`es(OIITO%LXDe2j_vfS0%Z4&B(nhrft{SOePBq}!+$tbnM}'
        ')k5JHsJo1vN~H6X39*298R)MDYZ-x}{75uTrv9>;Y%wfht1#U8`wkaBwyM1Msp~tdS*fa%iu-w8J'
        'DFp}5_d%knWNS~fst1qg762>HlFDObsOjd(mEtjx*Snlny=6d{*54YFxiA|wOxz?2jX2;;#d4nQO'
        '!1wsM5|Lb~<kPTC7s-T=^)EHXS!}G*jlxahixo(AF4MYH*M*Z(><=|a|W?$%>ab_NqtdPPWxEcEb'
        '{!~^%MO*Gxk`*gWos;JW2NO~QTht~eKR-VRk~I}22Yve4fD)9SKA<9<G}II|6N{YOehPwxY#Nl+Y'
        'a5UK!mmoU%S6GF)54v|Fp4uU1}8d=Jo2hFMhXl<*!$<NzsKo@$GjKh5=1An<pl@j9v<hCs&ZB%Ig'
        '8dL;|T^7PqT`F()k)}clznSAPZQX8)y(t@9d}16B6E1;;2C0j4FoyAqA&e$Fa@H+nJ}ugzTigGZ8'
        '~;Sm8M8xsb;?rk1~34A0jDpANRIwpLrj_V(F&Hk4b+rF;Noh2Ht$P@<rs0M6;0qajD)@wlH4MbU6'
        '`!wd(^yzzLjX@dsknUc*JLpq^IMY#rRSJjHbW_IV7kBsv(CYY`-C~jGrC3i$fgVFO6h&P&b9AOpV'
        'U<g=-qJHmdaD=_2f-XRXG)vN~XqCeCUSiU*#~shy@ADIKct{RDzc_pG9DjaVb8*`kEO-zRV~15It'
        'o%PlZ5Ii=%@#(t>ukh2X^?@|*Ld)q#2Yc^6)aj#RT{e{s*9nDWPYhLY*+c&TY7vZ+)#Z_zLGu<2t'
        'EM*q=lI=fk!#-Ik-+)1mz@#-t05pZP%=XGpX#}Ys^hqRmo=B4qWa{xErQO=TN7!bA<crJ+udA#Q#'
        'n{lP;SrO^>lUE-)}mSRdT3fZn?cK9RfL4d3vPhcm@sRSI<NvS){Nglq{s#TCIBzQclG@}k9B7}W&'
        'JYQZ=GOh5#tz_dz)i!4o;lUWyzR}>THQR8CP>%dpT)E6KY_UVXAOorLcth@YX8X>T{=dQ@3c6&({'
        'W_y7&n6(bcxg8~fHnuR1FF~}3>Kxy-aUi(epJq(oK!a7=K%A5QmaNm}{%&o&lbYH5K>@#T0hNiRF'
        'aZ`|;_M3>v<T<E#~rW%PK;bEIE0d#+~sK+AJ8DmBX=mVX@8q>yy{Z68s0BIZAex!l(I7%AZvxxOI'
        'kpA!WPWTTukgvA}jln=j7S530Z|Fe6s??(RaSz$)Qb}1^U=X82D^D{!g>U`~Su+PN%-ucR_ZN-yK'
        'G;!OrMLZ-qTEz&H)em}Vvt!tkCpOY=zVl>~V}eoyRrI_`{liK$s^nluOnvCg+I9=>JM%>>z?=Qfs'
        '|c7(zj-qA@nK&04vti-yOb?Zw|l~m0!mm2BJ)<xDUjS{|x<ZIQw6se{540(+Md{mB+4oY&4wkj#j'
        '2L`L0gnY3ReEasbtLa*4K<o5&p7Xn%9doGZ1Cv%HGl~k$P}_zC6_`aPdg<fMs3G-*Ch9|f`Z4N5u'
        '_;Y=owTO(rlJn(hrYh|287Xu4vnF~?heZYdw?66ciA?VE%vVyBCBo*1BxjD*ejH$<pL8dYnb>g-S'
        '@^Ly`ovZ+3rnT+dx{yu>rk(e|_<(qu)2$iM@{>GN>(Qrk!Ir|7@X!#46rIw(D@X5=lt>mjb>Up^f'
        'l!O;$B1AWTOeJASKg#{E2#3RCF{`|CB6pQ5(JUf=EXpse%b&#0i&A8AE=Xq{dG>ER~OtYS)=#KFx'
        's@NNNZ=smoF$0Jc*S;**Wu?IBujT9toA*8~Dx-zIAcQ9x+Dtq4E*jabsRvZ5g&kw(lS5or6Qw_jE'
        'dBcXe|McwB++Nrhns5XiB#irz!M=g6K2Y9z4encY=i#u@<>5~5V!dj4`PzN$U4x}$R4fNXuBraOG'
        '{Z;!W8h51DSjqd6Nk1A;~fJEH2(&k8&H^W_WuJFet%xztKs#y0$T1vIK<E!{xtd*k`j8('
    ),
    'macos/Storebase/MainWindow.swift': (
        'c-pO4+m72d5PkPoOpQKBg`?Q+uDdmmUiOk~(A{KV=K>T33R)W5?8>A-QFfeQfjspCihe_Xq3`{ad'
        '`XAYjq)Yyq<t|YYB-m}nKMK4MIx1kACu%Ku3J2R8?X3OzkJ$irCMd7hHJ*fYc3+W8p11%D|pue_~'
        'Ak<xsqamLO-AUh9tLS3KlZLcxV(}o2M2@n&pX%)<a0;0&5Kbug02%w_cjCkc-(6x_<EiV2&(8RlJ'
        '<@C8syf59AV6%+}tSjHL=zbFMLvX1iW{-JpBo`^6SM&0Pr+#uY}DUVxA#I#YN`9u;eMfN_eBh}q+'
        'QZ`HrSRIvqmD<0|j5RSUt++Z-FKxRs2BFcU9$mkII19%Ai<Kqs@6ryk!CUJ)Kd*OGGD4e3Ay;jLM'
        'oFf?vBBpK&0VxPtBt+j8@uiw6J<5dUB<Wi(?+ogR;!CE{qMw7gjsN8a{=I&E08bZehF<$h&ScxKk'
        'O>r~{4JZrWUF4}LZeD#%ruw63+8+_cfK|eJL-@-B%sZ+BNfIx8P8dQ-pHVc(TGxti5Xc6r4pz{Ea'
        'F*8PIfzx>UB)$1)-$4MJBVfI`|@|Sj=ZOH%Tg{@F_mpRtD<C3Gf2nXs<oiQsIQ9=tOIrCktMXu2Y'
        'Q*k3uJ_y+H?7MF>HP3qFx?<oiv1jpX|t+P`>oP&!Lra2=x$|NITTpf_m45ZdMeKD_^v(vGaaT4u^'
        '-AbAQQskz^wzP}-&Fwe!Y!HJ}ifTAQ?`;CkS7!x3-uG|DqSY*)hdMEy_Tq<j0Z#91$`QA|teGdGM'
        'jattU1O*E*7q`Gf)PMk{N-m%}BKYw8A23EuXFp5r%QXvuB}w3>>U~HZfRhp8Z!j9uZf`CXe@i+U@'
        '!OOUV|0MnNb}Gv5L2SxasqqIF^;_UT<c``@L})UKArMOKxf?_9({AtZFfME)DXVRGsVRIa&&dB*i'
        '<{#b*ZWFQ0298DisxUDL2ND2(2*q<LTM?gNw&cE;lV0JkRLq6HU~78lwi{CV1p9D;>avQc`V}6Uq'
        'JOtfk7S^R;+5&9s)nwZ_t0;zG7!TswXhOqjEK%qFHMz1vrz6vSzku1%SqNg;@LXywEEzif3DD;q^'
        '<DQ&^tyv|vT7;wr3HKEM{3ntd#BBF`K6r&r;W-h2iO7Va!5<a${Rcl*-Ok%39>T|?X!^6>bAl0E2'
        '<xRG(P|S>@Cm$*GIxa3Q3x4aL5Zk&Ht!1*47M!m7xy&%Anc;GKLx`ry>|v5JF+3KU7Bnm}LCYESk'
        'F(r0R~q1FYoW0OaK=^G=xh}S#Bl+0TCh$~1biXvAyDo(BMIfr?g3>Z=eOJA@t|&x$AhM9-jVYfdP'
        'aN7DEGV6PFR+rb>HT4LZeguw(Z4sf%dx}?{j<7^e~)kE;n&<HQ%+ipPIEqv2fwg*c{{JUfa}c2#_'
        '*aEhb|#KUFJL=^U7}N6oCV#Nsyk)_oxNj_(86(K*g0`ardtiFQ!4vx3xs@rp0F_WJ(TDO5y!5IO@'
        'FohL}Fpw)V0hf(6}8A{+{t0s5p^fwEYC23|VH80Hri>=zVv%dFa;&zRa-+@6nu<!6yQHGRQ(G9B5'
        'q4m9)oa?LR;EmZar8$R6{mQhhd%I}w(`UcdRu_zE2D?}`JpZ4@r#hRyuE!(AL`v73E1qhvT0QiVX'
        'Psz_12nuB72o!&dyz~~l*`UEut6i&D6)}U6?&@ZO1;lX2{<={hW6Ju`E14KJPnJ%q613W%S?p%eV'
        'Z?7vTQc8OqllWe}bvQhIxmoh7_lrxARJ)dGCwn1sW6*MG9y?lN$2Hc44NvZ0}><dUMf?L5gy7`Nd'
        'Lm)ZXuA$$p1>dP56zv*4+{AFMc4tG!*BVLK@8o3Ym3JRWTZVOC9}4S0I7NVFLccSz9G4#Rz0-3ZO'
        'v?&#`r--wN_jgz%Tr&0|@r?f;DUXWAR`cC(ARLfdsC#KU(givk#mAtTjMm!aIKn?A|cTFb@KvP1;'
        's63-`*N>%IFs-YL<CN~<v~07H<P4oQ0-pw{)#sU8T%~20o6Ym`uJtcN-jKB'
    ),
    'macos/Storebase/MenuBarView.swift': (
        'c-pO3+iv4F5PkPoObv7)6{%olvw0BETP|&bX0vI$*#(LM1trlAyA&yql)Y}?@9KNMtV8NzNtR<L?'
        'Mot!hjZq}Gb5JeQW^Lm&wpWN#LBnnlFiKh)o7%RDiQ;4sVL5f`oQQi0{a&pM*!bniUm_rWK@`U@t'
        '+hG7eqlOQ_3T2@vVItp{5nbGF?TWWkxp^06t6&Nj`amv$?YqLBJ_VnV27e&Pjp~5rijxr4I1(_JI'
        'WdQME%K;H)r43Xdd)NfDLq1xC*2oSu{16pFUB0e*7`9TC7eQwgV@-w^@?Gsd}Bn#>7PG=*2MDhN%'
        'DL3ebJlqi>i#2gjAgLBEH3YHJdP>9-ZfwUo*l{X2(V}Bb=k&JpvmYRnM-kcu617-6EW1qXaR~ea8'
        'Pp`D0*$tklqdwflaZU<NU3g>kah!9qD&MxflEQdF3Fc|`7or_cj$m2&h9DV>B~J(9k&4chEJQjrE'
        '6nc8@)&blu1+4?NbAw|QxLnJC{Y89jfu^XAZ6Micwe*~YAHNWo_l*Ucxy8VmE0u}8w)R2E%8T<#e'
        ';6aNw-bk)6b@xF~t1c(}tKrzh{PHTmSPngh6=fz}-W)1Vg0@-|Q=$11@2vMQj|>ezW~{-YPzVB~q'
        'kBt$K=_33|;kX1rs6tCs6Ji3g?dw4K7AC~}cet2<Pq3LarjB`~qY1Vc9cK0T0J7nUDNLOAeBH>U<'
        '!Wk)}6GXeS?*enO`9lomW4R&98OO<8Ez4xKCSJTPKM!zbyR7fb-B&NJ=YOv6u-&5IF=B9+Lj^;$0'
        '%SFfYy<K%sM|HcY23ADq8CBOz8?TXGum!`$z?#YhRmgu&m37paHREYT3uA1QsvI(>q85ApE;6!{_'
        'D(J<J56-8-FIjNrdSRd6HR;8KhpTwhWFB4jr?oDOb_{HiZedI(VH<r4D|%#&x0>@5iqrP$_uM0*6'
        'r@s$CFAN<7F)C>$RA_Rf)-@Y(Cdfxnc|S%IzL4Qj9PNg=p0UW;5u7jbSN@^ekX}BMp?oapfs0Kh6'
        '4^!_{U1Qq+g*U))$o$GhFEN%e3~%dV(=0wPlM8*d4$WT8Od8Njap1UWCXi^v*HP#o00acWAvZ~6g'
        'Rsofv~rZ2PHtZ>K-Xx!gjL$vE?J9;Y{j(o!~y|{6v#VbQw<Y4o6h9d3zAZM`kyP}$^#YSf^-?Ks_'
        '&>Z{&z2F6={7RTp9JF75+jYVwXolIbCeN`0&5u%L#28BtPGJ@#R_vM`^(=#T0-pui+4E*fW{s7og'
        'e`k^-K^VfKKh^c?WToIg`u0u))URW*&|hGYoHt#naAf0+HlgIkeIAXl00}lWXmB)rCE3AzGN3_J`'
        '08?eQUf}yr9UrbQbN(bYH)?E$KooMg88Ny3bfz+Gqmrz<{aEAPW1xPBDt6vw9}+I$)1_rD-He_f>'
        ';4Kb%bbz<GvD?)(0iL+)o%NSh*>Ua&bc-hYU2y?^Bkd+W~rh3k1s*UJ~Lr<SjS7O(@Buug&c=hsi'
        '>a@R68w7jjGN!n(R&bW=LAzqS`&7mW|jC`VJND>~_cgE(0BIO72dHdB-VV^`g2XI$I(jGn02d|s#'
        'SD|I(^T#r40Yggyt8@fI1+S0Q8$y7Km|+RwN6>unHg)cL#q=%C0qs7ECc!D*?XafVe*yEb0(S'
    ),
    'macos/make-dmg.sh': (
        'c-oy;(QX^N5q;NJOg2Ff1K!njP+XuY6jZj>u3A}gwQ_phBrxb*O3SMixh1)l4Ld-d`T<2>`UCy2d'
        '`V}>l~$4y=b|rOnH&yh&di({zI@TX5wd;5Ox}74$CW5DNUYKvS9rwA5}3?jrCABWf{?(Ve|{Fhq>'
        '^BBVL;K+IZI(BY!1JqD&tYha0?-?6qKUmGbV~wYcd{ByTPkBX$JT=6I!w*$Dcn12LZf(4dp632wL'
        'My5_-T-CwxUm+L<u+bI|I?lfnDAPn-46wLp|{EpB;6Lg!~FfQQ?S3)ylWw32D>EUvfQ!eE3;!y&1'
        'we|Ewn)X)+$`0#-&tekzJLF-<0A?P!`5;A~KpZ<V;bJ+smX|5oc5(qgnU=?TtWsOG!<C05QvQ(KZ'
        'bM6SBQmbDHONZ7WC=ID9?>(L~RiHzp&BIFYlisMkWD6dm^^wT~c=!4(nQ(_eIcm*>GyDZO?KdunV'
        'Vd)FaVoU2LsrQ&Pb{;Qfp_hU-?n8{6!7-l>!UqyoJAmv{QBiT7G^>Ulk*HPo>s^?R3-W6>~t>rEZ'
        '~OYa*CdiF3|jmy`7E0?iK)3WopOTLZn<8{zExbz2(z4aCiv`1@5MjS%IEpK%vPw`hur`&AGJTb$$'
        'KvZ$Q*+&MaU=Qf>@-4#o<^h837ohp4S^7m@S3W$|l;>Snky*9!0QmtgE*#!_C8E{bV{8u|*Pvd}B'
        'bf+wjKr49d43ERQYLT@x_^n&EK7<$diLU7|E@1QpB5Nay5kk*hkGAM!tSsMP{`xdo4XsE6%$zCS!'
        'DRbnG?O(tAH)zp0=8ra)?<EF2K7!R1-xl5q#P_64!Fh?HXe}35;}DkMsxD~hB?fPX|G8QW@CR0_`'
        '}lGWD0ICn%vB1NbO27{-ud;Q?}EZ@1ii|tC9@(0Bj(O6$2n4g<!p&XDCfr46ukWzwPA%___*RHt5'
        'SQx(gmA)Y%<8IWl3REm0=V>HG`;3mrw}FP1H&TXQS)h<SgmF!3;YY_v34~luWONard0biWNH>gMK'
        '`k4yIS#APlxQ2BWiUB$)BvkiM?sWPfWC|MhY(!M)LVSKa8(@yYc1xR=D&PVq24$8SP%2Q^QH5&?X'
        'uaq5Jhclc?`fqm;6B>VCEcsRZw&DW#{8L?Iu9JF|`ro)HJ5gm{HC0!)MqaWV2?e}Q>U8fIR+4d$U'
        'f9f{0yTo4L)7iD8ofL+n=;&uEJ$Us%$3DB9{>AAZj@KQa$<?S($oTvD=;V(t2gAOLZzGQXghbFhw'
        'J7Ua%s1$pA{-jzShRMtO>3!=Gcm6;qKi~HK`N*>>NeG9mR&GR+pWxZyU07z9}3EXS@dt&#qKdq4w'
        '+8#ZtW`x(~pE&*Jfor8eU!ZPNt~t+9B!l3`I79`S8b2PSpE&uxWG;@8ikwIElX#SQKcG@;Z3o9C8'
        'ik={69#Vf%j<yxN2$*ljgydiT=?jR!o7V91bAxz<XXO}hY?BO5{(L*RBgk1M9B@;i_2MmX&ahKL~'
        'ST=rO>x<xYV|0TXdI!%SW&^%Skk}f+(Hb92?`1p|uo(@<vf~x6vKhez_HfwA>C8onf>OgZ7z#B}$'
        '8o%z*Zp%Ape5kt<AW!>TzqsgbqThBXv}=Yk?K)%HJKZLz!}S6a1${*Y-<U*dIM+S<rm}l2YsKomj'
        't$T2c+x%7@=4COv2hJBt0R$06ZqTPCrVoEq-3s9l}3);6|3hFsutpE2t({_Vs^ha{`o0nq~I1CaO'
        'QX(rxwj!vu3_KtjXUfI2F<jOPVw6i|7TTwh8ELM7h3oJ(g37yn=N`nGyO`{Gm!JIYW)o3Syp+KE|'
        '?T*_BFi_~=3yhUl%Z1(rK?;3pV0KyS;{Xax@1Eduf_kiZTnYeeeR{kRusrU3#MlbCs1*P`2th<Ki'
        'f3TGEc2@P*}c&iFWs113#Wuw!2&fN54x2|sem&gZ`<g)+wv0L!Xx|xpanfY6U;UhS~8HS}4r5!8x'
        'y#uJnf@h>qC=(Xv;TovtMemrkh;pi*ll$)U0x(P_@!24m#*=Q)PVSB6%l1&*Xr}Mmry8MLDZMb5|'
        'C%RU-{RD2qS<<VTcRGipUNavSt@PYg~8boA2(bFo=vHr-=UX{2|K{T-c~sKKV8IR1bkmqY5oH&6+'
        'K{{7xB>^NGzBFi50NQ4GJPlzRB?6R~1++n2y<VY8o;b$eDtZ(_=TgCpn_@-s?-Ord)cv<rMnkF0b'
        'T5s+BzOMMg`_9K1a*eEsLYz-O`FzETw!oc#)V-Ee$trPU3-7m&dY>5Z$>#rhu{6&X&NGE*!6STO9'
        '~IHl2A*<c3uq|ZGayt<s}EX=6o!@RgJ^Fv5VWeYLSEe*7UExELQHMj>LksLh@w#t=m|4|%*)^8ot'
        'ytS8-=#OU|&}2@SqTa<`uOPVG1GafP5iz>Q>Tjws7mxn|^}jbl'
    ),
}


def write(rel: str, parts) -> None:
    data = zlib.decompress(base64.b85decode("".join(parts)))
    path = root / rel
    path.write_bytes(data)
    print("Wrote", path, f"({len(data)} bytes)")

for rel, parts in FILES.items():
    write(rel, parts)

info = root / "macos/Storebase/Info.plist"
if info.exists():
    text = info.read_text()
    text = text.replace("<string>1.13</string>", "<string>1.16</string>").replace(
        "<string>1.14</string>", "<string>1.16</string>"
    ).replace("<string>1.15</string>", "<string>1.16</string>")
    # CFBundleVersion lives right under ShortVersionString
    text = text.replace(
        "<key>CFBundleVersion</key>\n  <string>21</string>",
        "<key>CFBundleVersion</key>\n  <string>25</string>",
    ).replace(
        "<key>CFBundleVersion</key>\n  <string>23</string>",
        "<key>CFBundleVersion</key>\n  <string>25</string>",
    ).replace(
        "<key>CFBundleVersion</key>\n  <string>24</string>",
        "<key>CFBundleVersion</key>\n  <string>25</string>",
    )
    info.write_text(text)
    print("Bumped", info)

pbx = root / "macos/Storebase.xcodeproj/project.pbxproj"
if pbx.exists():
    text = pbx.read_text()
    for old, new in (
        ("MARKETING_VERSION = 1.13;", "MARKETING_VERSION = 1.16;"),
        ("MARKETING_VERSION = 1.14;", "MARKETING_VERSION = 1.16;"),
        ("MARKETING_VERSION = 1.15;", "MARKETING_VERSION = 1.16;"),
        ("CURRENT_PROJECT_VERSION = 21;", "CURRENT_PROJECT_VERSION = 25;"),
        ("CURRENT_PROJECT_VERSION = 23;", "CURRENT_PROJECT_VERSION = 25;"),
        ("CURRENT_PROJECT_VERSION = 24;", "CURRENT_PROJECT_VERSION = 25;"),
    ):
        text = text.replace(old, new)
    pbx.write_text(text)
    print("Bumped", pbx)

main = root / "macos/Storebase/MainWindow.swift"
if main.exists() and "1.16" not in main.read_text():
    print("WARNING: MainWindow.swift does not say 1.16")

print()
print("Installed 1.16 sources. Now run:")
print("  killall -9 Storebase")
print("  cd macos")
print("  ./make-dmg.sh")
print("  defaults read /Applications/Storebase.app/Contents/Info CFBundleShortVersionString")
print("That last line must print 1.16.")
