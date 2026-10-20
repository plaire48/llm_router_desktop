"""Independent numeric/string oracles, not an alternative spreadsheet calculator."""
import math,statistics,datetime,json,sys
from pathlib import Path
fixtures=[]
for variant,n in [('base',1),('input_change',3),('zero',0)]:
    a=[2*n,4*n,6*n];b=[5*n,10*n,15*n]
    values=[
      ('SUM','SUM(A1:A3)',sum(a)),('AVERAGE','AVERAGE(A1:A3)',statistics.mean(a)),('MIN','MIN(A1:A3)',min(a)),('MAX','MAX(A1:A3)',max(a)),
      ('COUNT','COUNT(A1:A3)',3),('COUNTA','COUNTA(C1:C3)',3),('COUNTBLANK','COUNTBLANK(G1:G3)',3),
      ('SUMPRODUCT','SUMPRODUCT(A1:A3,B1:B3)',sum(x*y for x,y in zip(a,b))),('SUBTOTAL','SUBTOTAL(9,A1:A3)',sum(a)),('AGGREGATE','AGGREGATE(9,0,A1:A3)',sum(a)),
      ('ABS','ABS(-A1)',abs(a[0])),('ROUNDUP','ROUNDUP(1.21,1)',1.3),('ROUNDDOWN','ROUNDDOWN(1.29,1)',1.2),('ROUND','ROUND(-10.125,2)',-10.13),
      ('INT','INT(-1.2)',-2),('TRUNC','TRUNC(-1.2)',-1),('MOD','MOD(A3,5)',a[2]%5),('QUOTIENT','QUOTIENT(A3,5)',a[2]//5),
      ('POWER','POWER(A1,2)',a[0]**2),('SQRT','SQRT(A1)',math.sqrt(a[0])),('EXP','EXP(1)',math.e),('LN','LN(EXP(1))',1),('LOG10','LOG10(100)',2),
      ('PI','PI()',math.pi),('SIN','SIN(PI()/2)',1),('COS','COS(0)',1),('TAN','TAN(0)',0),('FACT','FACT(5)',120),('COMBIN','COMBIN(5,2)',10),('GCD','GCD(12,18)',6),('LCM','LCM(4,6)',12),
      ('MEDIAN','MEDIAN(A1:A3)',statistics.median(a)),('LARGE','LARGE(A1:A3,2)',a[1]),('SMALL','SMALL(A1:A3,2)',a[1]),
      ('STDEV.S','STDEV.S(A1:A3)',statistics.stdev(a)),('VAR.S','VAR.S(A1:A3)',statistics.variance(a)),('STDEV.P','STDEV.P(A1:A3)',statistics.pstdev(a)),('VAR.P','VAR.P(A1:A3)',statistics.pvariance(a)),
      ('NORM.DIST','NORM.DIST(0,0,1,TRUE)',.5),('NORM.INV','NORM.INV(0.5,0,1)',0),('RANK.EQ','RANK.EQ(A1,A1:A3)',3 if n else 1),
      ('AND','AND(A1>=0,A3>=A1)',1),('OR','OR(A1>0,A3>0)',int(n>0)),('NOT','NOT(A1>0)',int(n==0)),('XOR','XOR(TRUE,FALSE)',1),
      ('IF','IF(A1>0,10,0)',10 if n else 0),('IFERROR','IFERROR(1/0,-1)',-1),('IFNA','IFNA(NA(),-2)',-2),('ISERROR','ISERROR(1/0)',1),('ISNUMBER','ISNUMBER(A1)',1),('ISTEXT','ISTEXT(C1)',1),('N','N(TRUE)',1),
      ('COUNTIF','COUNTIF(A1:A3,">0")',3 if n else 0),('COUNTIFS','COUNTIFS(A1:A3,">0",B1:B3,">0")',3 if n else 0),('SUMIF','SUMIF(A1:A3,">0",B1:B3)',sum(b)),('SUMIFS','SUMIFS(B1:B3,A1:A3,">0")',sum(b)),
      ('AVERAGEIF','IFERROR(AVERAGEIF(A1:A3,">0",B1:B3),0)',statistics.mean(b)),('AVERAGEIFS','IFERROR(AVERAGEIFS(B1:B3,A1:A3,">0"),0)',statistics.mean(b)),
      ('VLOOKUP','VLOOKUP("m",C1:D3,2,FALSE)',22*n),('HLOOKUP','HLOOKUP(A1,A1:B2,2,FALSE)',4*n),('INDEX','INDEX(B1:B3,2)',10*n),('MATCH','MATCH("m",C1:C3,0)',2),('LOOKUP','LOOKUP(A3,A1:A3,B1:B3)',15*n),
      ('CHOOSE','CHOOSE(2,A1,A2,A3)',4*n),('INDIRECT','INDIRECT("A2")',4*n),('OFFSET','SUM(OFFSET(A1,0,0,3,1))',sum(a)),('ROW','ROW(A3)',3),('COLUMN','COLUMN(B1)',2),('ROWS','ROWS(A1:B3)',3),('COLUMNS','COLUMNS(A1:B3)',2),
      ('LEN','LEN("abc")',3),('LEFT','LEFT("abc",2)','ab'),('RIGHT','RIGHT("abc",2)','bc'),('MID','MID("abc",2,1)','b'),('LOWER','LOWER("AbC")','abc'),('UPPER','UPPER("AbC")','ABC'),('PROPER','PROPER("hello world")','Hello World'),('TRIM','TRIM(" a  b ")','a b'),
      ('CONCATENATE','CONCATENATE("a","b")','ab'),('SUBSTITUTE','SUBSTITUTE("aaa","a","b")','bbb'),('REPLACE','REPLACE("abc",2,1,"X")','aXc'),('FIND','FIND("b","abc")',2),('SEARCH','SEARCH("B","abc")',2),('EXACT','EXACT("a","A")',0),('VALUE','VALUE("12.5")',12.5),
      ('DATE','DATE(2024,2,29)',45351),('YEAR','YEAR(DATE(2024,2,29))',2024),('MONTH','MONTH(DATE(2024,2,29))',2),('DAY','DAY(DATE(2024,2,29))',29),('DAYS','DAYS(DATE(2024,3,1),DATE(2024,2,28))',2),
      ('NETWORKDAYS','NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,5))',5),('WORKDAY','DAY(WORKDAY(DATE(2024,1,5),1))',8),('EOMONTH','DAY(EOMONTH(DATE(2024,2,1),0))',29),('EDATE','MONTH(EDATE(DATE(2024,1,1),2))',3),('WEEKDAY','WEEKDAY(DATE(2024,1,1),2)',1),('TEXT','TEXT(DATE(2024,2,29),"yyyy-mm-dd")','2024-02-29'),
      ('PMT','PMT(0.01,12,-1000)',1000*.01/(1-(1.01)**-12)),('FV','FV(0.01,12,-10,-100)',100*1.01**12+10*(1.01**12-1)/.01),('PV','PV(0.01,12,-10)',10*(1-1.01**-12)/.01),('NPV','NPV(0.1,A1:A3)',sum(x/(1.1)**(i+1) for i,x in enumerate(a))),
      ('BIN2DEC','BIN2DEC("101")',5),('DEC2BIN','DEC2BIN(5)','101'),('BITAND','BITAND(6,3)',2),('BITOR','BITOR(6,3)',7),('BITXOR','BITXOR(6,3)',5),('CONVERT','CONVERT(100,"cm","m")',1),
      ('percent_power_exponent','1e-3+2^3+50%',8.501),('array_constant','SUM({1,2;3,4})',10),('long_formula','SUM('+','.join(['A1']*150)+')',a[0]*150)
    ]
    fixtures.append(dict(name=variant,inputs=dict(a=a,b=b),expected=[dict(feature=k,formula=f,value=v,address='F'+str(i+1)) for i,(k,f,v) in enumerate(values)]))
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True);(out/'oracle-contracts.json').write_text(json.dumps(dict(kind='independent_broad_formula_oracles',fixtures=fixtures),ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(fixtures=len(fixtures),checks=sum(len(f['expected'])for f in fixtures))))
