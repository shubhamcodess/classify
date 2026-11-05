import laya_export as L
SHORT=[{"t":"choice","ins":"Which department?","crit":{"billing":"payments","technical":"bugs","other":""}},{"t":"noul","ins":"Does the user ask for a refund?","crit":None},{"t":"score","ins":"How urgent?","crit":["low","medium","high"]}]
def cases(tok,cfg,max_len):
    txt="Hi, we were billed twice for March. Please refund the duplicate today or we will cancel."
    return [L.batch_from(tok,cfg,s,SHORT,max_len) for s in (txt, " ".join([txt]*40))]
