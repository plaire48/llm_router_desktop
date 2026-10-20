"""Small independent answers for reference-engine gaps, never a product calculator.

Keep each authored input and mathematical/domain rule explicit. Original LO
values remain alongside these values, including disagreements.
"""
import math,cmath,datetime
def oracle(case,n):
    name=case['name'];a=2*n;source='https://support.microsoft.com/en-us/excel/functions/'+name.lower().replace('.','-')+'-function'
    out=None
    complex_ops={'IMCOSH':cmath.cosh,'IMSINH':cmath.sinh,'IMTAN':cmath.tan,'IMCOT':lambda z:1/cmath.tan(z),'IMCSC':lambda z:1/cmath.sin(z),'IMCSCH':lambda z:1/cmath.sinh(z),'IMSEC':lambda z:1/cmath.cos(z),'IMSECH':lambda z:1/cmath.cosh(z)}
    if name in complex_ops:
        assert case['formula']==name+'("1+2i")';z=complex_ops[name](1+2j);out=dict(value=f'{z.real:.16g}{z.imag:+.16g}i',error=False,rule='Python cmath on authored complex input')
    elif name=='BINOM.DIST.RANGE':
        assert case['formula']=='BINOM.DIST.RANGE(5,0.4,1,3)';out=dict(value=sum(math.comb(5,k)*.4**k*.6**(5-k) for k in range(1,4)),error=False,rule='Independent finite binomial sum')
    elif name in ['DBCS','JIS']:
        assert case['formula']==name+'("ABC123")';out=dict(value=''.join(chr(ord(c)+0xfee0) for c in 'ABC123'),error=False,rule='Unicode fullwidth Latin and digits; no claim for every locale')
    elif name=='BAHTTEXT' and case['formula']=='BAHTTEXT(1234)':
        out=dict(value='หนึ่งพันสองร้อยสามสิบสี่บาทถ้วน',error=False,rule='Official Microsoft example, repeated constant input')
    elif name=='NETWORKDAYS.INTL':
        assert case['formula']=='NETWORKDAYS.INTL(DATE(2024,1,1),DATE(2024,1,10),11)';start=datetime.date(2024,1,1);out=dict(value=sum((start+datetime.timedelta(days=i)).weekday()!=6 for i in range(10)),error=False,rule='Independent inclusive calendar count; Sunday only weekend')
    elif name=='WORKDAY.INTL':
        assert case['formula']=='WORKDAY.INTL(DATE(2024,1,5),3,11)';date=datetime.date(2024,1,5);count=0
        while count<3:
            date+=datetime.timedelta(days=1);count+=date.weekday()!=6
        out=dict(value=(date-datetime.date(1899,12,30)).days,error=False,rule='Independent calendar iteration; Sunday only weekend')
    elif name in ['TBILLPRICE','TBILLEQ','TBILLYIELD']:
        assert 'DATE(2024,1,1),DATE(2024,6,1)' in case['formula'];days=(datetime.date(2024,6,1)-datetime.date(2024,1,1)).days
        value=100*(1-.05*days/360) if name=='TBILLPRICE' else 365*.05/(360-.05*days) if name=='TBILLEQ' else (100-97)/97*360/days
        out=dict(value=value,error=False,rule='Independent actual calendar days and documented Treasury bill arithmetic; LO disagreement retained')
    elif name in ['GEOMEAN','HARMEAN'] and n==0:
        out=dict(value='#NUM!',error=True,rule='Microsoft domain: nonpositive data produces NUM; LO disagreement retained')
    elif name in ['F.TEST','FTEST','SKEW','SKEW.P'] and n==0:
        out=dict(value='#DIV/0!',error=True,rule='Microsoft documented zero variance/deviation error; LO VALUE disagreement retained')
        if name=='FTEST':source='https://support.microsoft.com/en-us/excel/functions/f-test-function'
    elif name=='PERCENTRANK.EXC' and n==0:
        out=dict(value=math.trunc(1000/6)/1000,error=False,rule='Lowest duplicate rank with three-digit truncation; LO rounding disagreement retained')
    elif name=='DOLLAR':
        assert case['formula']=='DOLLAR(A1+1000.25,2)';out=dict(value=f'${a+1000.25:,.2f}',error=False,rule='Explicit en-US engine locale, two decimal currency string')
    elif name=='ODDFPRICE':
        assert case['formula']=='ODDFPRICE(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0785,0.0625,100,2,1)';out=dict(value=113.60,error=False,absoluteTolerance=.005,rule='Official rounded example; not full-precision independent verification')
    elif name=='ODDFYIELD':
        assert case['formula']=='ODDFYIELD(DATE(2008,11,11),DATE(2021,3,1),DATE(2008,10,15),DATE(2009,3,1),0.0575,84.5,100,2,0)';out=dict(value=.0772,error=False,absoluteTolerance=.00005,rule='Official rounded example; not full-precision independent verification')
    if out is not None:out['source']=source
    return out
