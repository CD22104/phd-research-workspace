// Reviewed official sources. Date-only announcements are intentionally not exact countdowns.
export type Milestone = { id:string; label:string; date:string; at:string|null; zone:string; cycle?:string; action:boolean; stage:string; requires?:string };
const aoe = (id:string,label:string,date:string,stage='submission',extra:Partial<Milestone>={}):Milestone => ({id,label,date,at:new Date(date+'T23:59:59-12:00').toISOString(),zone:'AOE',action:true,stage,...extra});
const day = (id:string,label:string,date:string):Milestone => ({id,label,date,at:null,zone:'AOE',action:false,stage:'announcement'});
export const CHECKED_AT = '2026-09-28';
// CCF seventh edition (2026), publisher-authored PDF mirrored by a researcher.
const ccf2026 = (rank:'A'|'B') => ({ccf:rank,ccf_edition:'2026',ccf_source:'https://dengpingfan.github.io/papers/CCF-Recommend-2026.pdf',checked_at:'2026-10-06'});
export const CONFERENCES = [
 {key:'www-2027',name:'WWW 2027',area:'Web',status:'verified',...ccf2026('A'),source:'https://www2027.thewebconf.org/research-track-papers/',note:'研究长文。以下是长文日期，短文为另一条投稿轨道。',milestones:[
  aoe('registration','长文摘要注册截止','2026-10-18','registration'),aoe('submission','长文正文提交截止','2026-10-25'),day('reviews','评审公布','2026-12-15'),aoe('rebuttal','作者回复截止','2026-12-20','rebuttal',{requires:'submission'}),day('decision','录用结果','2027-01-04')]},
 {key:'ijcai-2027',name:'IJCAI 2027',area:'综合 AI',status:'verified',...ccf2026('B'),source:'https://2027.ijcai.org/',note:'2026 年 CCF 第七版列为 B 类，',milestones:[
  aoe('registration','摘要截止','2027-01-04','registration'),aoe('submission','正文提交截止','2027-01-11'),day('decision','录用结果','2027-04-21')]},
 {key:'sigir-2027',name:'SIGIR 2027',area:'检索与数据挖掘',status:'pending',...ccf2026('A'),source:'https://sigir2027.org/pages/submit-full.html',note:'官网摘要 2027-01-14、正文 2027-01-21 AOE 仍标为 PROPOSED（拟定），确认后再计入倒计时。',milestones:[]},
 {key:'kdd-2027',name:'KDD 2027',area:'检索与数据挖掘',status:'pending',...ccf2026('A'),source:'https://kdd2027.kdd.org/research-track-call-for-papers/',note:'第一轮已截止；下一轮为 2027 年 2 月，具体截止日待公布。',milestones:[]},
 {key:'aaai-2027',name:'AAAI 2027',area:'综合 AI',status:'verified',...ccf2026('A'),source:'https://aaai.org/conference/aaai/aaai-27/aia-call/',note:'所列为 AI Alignment 技术轨（不是主会）。本届新投稿已截止，后续回复仅适用于已投论文。',milestones:[
  aoe('registration','摘要截止','2026-08-14','registration',{cycle:'AI Alignment'}),aoe('submission','正文提交截止','2026-08-21','submission',{cycle:'AI Alignment'}),aoe('rebuttal','作者回复截止','2026-11-02','rebuttal',{cycle:'AI Alignment',requires:'submission'}),day('decision','录用结果','2026-11-30')]},
 {key:'issta-2027',name:'ISSTA 2027',area:'软件工程',status:'verified',...ccf2026('A'),source:'https://conf.researchr.org/track/issta-2027/issta-2027-research-papers',note:'官方已列研究论文日期，详细征稿正文尚待补充；需关注软件测试与分析贡献。',milestones:[
  aoe('registration','强制摘要注册截止','2027-01-08','registration'),aoe('submission','正文提交截止','2027-01-11'),aoe('rebuttal','作者回复截止','2027-03-25','rebuttal',{requires:'submission'}),day('decision','初步结果','2027-04-20'),day('final-decision','最终结果','2027-06-17')]},
 {key:'icse-2027',name:'ICSE 2027',area:'软件工程',status:'verified',...ccf2026('A'),source:'https://conf.researchr.org/track/icse-2027/icse-2027-research-track',note:'研究主轨只有一轮，本届新投稿已截止；其他轨道日期不能作为研究主轨截止日。',milestones:[
  aoe('registration','摘要注册截止','2026-06-23','registration'),aoe('submission','正文提交截止','2026-06-30'),day('decision','初步结果','2026-10-20'),day('final-decision','大修论文最终结果','2026-12-18')]},
 {key:'fse-2027',name:'FSE 2027',area:'软件工程',status:'verified',...ccf2026('A'),source:'https://conf.researchr.org/track/fse-2027/fse-2027-papers',note:'研究主轨已于 2026-10-02 AOE 截止；后续回复仅适用于已投论文。',milestones:[
  aoe('submission','研究论文提交截止','2026-10-02'),aoe('rebuttal','作者回复截止','2026-12-18','rebuttal',{requires:'submission'}),day('decision','初步结果','2027-01-22'),day('final-decision','最终结果','2027-03-31')]},
 {key:'ase-2027',name:'ASE 2027',area:'软件工程',status:'unconfirmed',...ccf2026('A'),source:'https://conf.researchr.org/series/ase',note:'尚未核实到 2027 年研究主轨征稿与截止日期，等待官方公告。',milestones:[]},
 {key:'cvpr-2027',name:'CVPR 2027',area:'视觉',status:'verified',source:'https://cvpr.thecvf.com/Conferences/2027/CallForPapers',note:'注册与正文提交日期固定，不延期。OpenReview 新账号请提前准备。',milestones:[
  aoe('registration','论文注册截止','2026-11-10','registration'),aoe('submission','正文提交截止','2026-11-16'),aoe('supplement','补充材料截止','2026-11-23','supplement',{requires:'submission'}),day('reviews','评审公布','2027-01-25'),aoe('rebuttal','Rebuttal 截止','2027-02-01','rebuttal',{requires:'submission'}),day('decision','最终结果','2027-02-25')]},
 {key:'iccv-2027',name:'ICCV 2027',area:'视觉',status:'pending',source:'https://iccv.thecvf.com/Conferences/2027/Dates',note:'官方日期页尚未列出主会论文投稿截止时间。',milestones:[]},
 {key:'eccv-2028',name:'ECCV 2028',area:'视觉',status:'unconfirmed',source:'https://www.ecva.net/',note:'后续一届投稿日期尚未核实；不使用 ECCV 2026 的历史日期推算。',milestones:[]},
 {key:'iclr-2027',name:'ICLR 2027',area:'机器学习',status:'verified',source:'https://iclr.cc/Conferences/2027/Dates',note:'本届摘要和正文投稿均已截止。',milestones:[aoe('registration','摘要截止','2026-09-18','registration'),aoe('submission','正文提交截止','2026-09-25')]},
 {key:'icml-2027',name:'ICML 2027',area:'机器学习',status:'unconfirmed',source:'https://icml.cc/',note:'尚未核实到 2027 主会投稿日期，等待官方征稿。',milestones:[]},
 {key:'neurips-2027',name:'NeurIPS 2027',area:'机器学习',status:'unconfirmed',source:'https://neurips.cc/',note:'尚未核实到 2027 主会投稿日期，等待官方征稿。',milestones:[]},
 {key:'acl-2027',name:'ACL 2027',area:'NLP',status:'pending',source:'https://2027.aclweb.org/',note:'官方将 ARR 投稿与会议 commitment 日期列为 TBA；二者是不同节点。',milestones:[]},
 {key:'emnlp-2027',name:'EMNLP 2027',area:'NLP',status:'unconfirmed',source:'https://www.aclweb.org/portal/',note:'尚未核实到 2027 主会投稿与 commitment 日期。',milestones:[]},
 {key:'naacl-2027',name:'NAACL 2027',area:'NLP',status:'verified',source:'https://2027.naacl.org/calls/main_conference_papers/',note:'先投 ARR 2026 年 10 月轮次，再将已有评审的论文 commit 到会议。审稿人注册与 ARR 投稿同日截止。',milestones:[aoe('submission','ARR 正文投稿截止','2026-10-12'),aoe('reviewer','所有作者审稿人注册截止','2026-10-12','registration'),aoe('commitment','会议 Commitment 截止','2026-12-23','commitment',{requires:'submission'}),day('decision','录用结果','2027-02-10')]},
 {key:'sp-2027',name:'IEEE S&P 2027',area:'安全',status:'verified',source:'https://sp2027.ieee-security.org/cfpapers.html',note:'主会分两轮。第二轮注册与正文分别在 11 月 10 日、17 日 AOE 截止。',milestones:[
  aoe('r1-registration','摘要注册截止','2026-06-04','registration',{cycle:'第一轮'}),aoe('r1-submission','正文提交截止','2026-06-11','submission',{cycle:'第一轮'}),
  aoe('r2-registration','摘要注册截止','2026-11-10','registration',{cycle:'第二轮'}),aoe('r2-submission','正文提交截止','2026-11-17','submission',{cycle:'第二轮'}),aoe('r2-rebuttal','Rebuttal 截止','2027-02-16','rebuttal',{cycle:'第二轮',requires:'r2-submission'})]},
 {key:'usenix-security-2027',name:'USENIX Security 2027',area:'安全',status:'verified',source:'https://www.usenix.org/conference/usenixsecurity27/call-for-papers',note:'主会分两轮；artifact 提交与正文提交分开列出。',milestones:[
  aoe('r1-registration','强制注册截止','2026-08-18','registration',{cycle:'Cycle 1'}),aoe('r1-submission','正文提交截止','2026-08-25','submission',{cycle:'Cycle 1'}),
  aoe('r2-registration','强制注册截止','2027-01-19','registration',{cycle:'Cycle 2'}),aoe('r2-submission','正文提交截止','2027-01-26','submission',{cycle:'Cycle 2'}),aoe('r2-artifact','Submission artifacts 截止','2027-01-29','supplement',{cycle:'Cycle 2',requires:'r2-submission'})]},
 {key:'ccs-2027',name:'ACM CCS 2027',area:'安全',status:'pending',source:'https://www.sigsac.org/ccs/CCS2027/',note:'官网仍为 Coming Soon，主会论文各轮截止时间待公布。',milestones:[]},
 {key:'ndss-2027',name:'NDSS 2027',area:'安全',status:'verified',source:'https://www.ndss-symposium.org/ndss2027/submissions/call-for-papers/',note:'夏季与秋季新论文投稿均已截止；后续 rebuttal 和修订仅适用于已投稿论文。',milestones:[
  aoe('summer-submission','正文提交截止','2026-05-06','submission',{cycle:'夏季轮'}),aoe('fall-submission','正文提交截止','2026-08-19','submission',{cycle:'秋季轮'}),aoe('fall-rebuttal','Rebuttal 截止','2026-11-13','rebuttal',{cycle:'秋季轮',requires:'fall-submission'})]},
] as const;
