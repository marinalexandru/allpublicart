const AllPublicArtCrowdsale = artifacts.require("./AllPublicArtCrowdsale.sol");
const AllPublicArtToken = artifacts.require("./AllPublicArtToken.sol");
const CompanyAllocation = artifacts.require("./CompanyAllocation.sol");

import { should, ensuresException, getBlockNow } from './helpers/utils'
import timer from './helpers/timer'

const BigNumber = web3.BigNumber

contract('AllPublicArtCrowdsale', ([owner, wallet, buyer, purchaser, buyer2, purchaser2, beneficiary, sender, founder1, founder2]) => {
    const rate = new BigNumber(50)
    const newRate =  new BigNumber(350000000); // 350M APA tokens per 1 eth
    const cap = new BigNumber(1000e+18)

    const preferentialRate = new BigNumber(100)
    const value = 1e+18
    const dayInSecs = 86400

    const expectedCompanyTokens = new BigNumber(650000000e+18)
    const expectedTokenSupply = new BigNumber(1000000000e+18)

    let startTime, endTime
    let preSaleEnds, firstBonusSalesEnds, secondBonusSalesEnds, thirdBonusSalesEnds
    let apaCrowdsale, apaToken
    let companyAllocationsContract

    const newCrowdsale = (rate) => {
        startTime = getBlockNow() + 20 // crowdsale starts in 20 seconds
        preSaleEnds = getBlockNow() + dayInSecs * 10 // 10 days
        firstBonusSalesEnds = getBlockNow() + dayInSecs * 20 // 20 days
        secondBonusSalesEnds = getBlockNow() + dayInSecs * 30 // 30 days
        thirdBonusSalesEnds = getBlockNow() + dayInSecs * 40 // 40 days
        endTime = getBlockNow() + dayInSecs * 60 // 60 days

        return AllPublicArtCrowdsale.new(
            startTime,
            preSaleEnds,
            firstBonusSalesEnds,
            secondBonusSalesEnds,
            thirdBonusSalesEnds,
            endTime,
            rate,
            cap,
            preferentialRate,
            wallet
        )
    }

  beforeEach('initialize contract', async () => {
    apaCrowdsale = await newCrowdsale(rate)
    apaToken = AllPublicArtToken.at(await apaCrowdsale.token())
  })

  it('has a cap', async () => {
      const crowdsaleCap = await apaCrowdsale.cap()
      crowdsaleCap.toNumber().should.equal(cap.toNumber())
  });

  it('has a normal crowdsale rate', async () => {
      const crowdsaleRate = await apaCrowdsale.rate()
      crowdsaleRate.toNumber().should.equal(rate.toNumber())
  })

  it('starts with token paused', async () => {
    const paused = await apaToken.paused()
    paused.should.equal(true)
  })

  it('owner should be able to unpause token after crowdsale ends', async function () {
    timer(endTime + 30)

    try {
        await apaCrowdsale.unpauseToken()
        assert.fail()
    } catch (error) {
        ensuresException(error)
    }

    await apaCrowdsale.finalize()

    let paused = await apaToken.paused()
    paused.should.equal(true)

    await apaCrowdsale.unpauseToken()

    paused = await apaToken.paused()
    paused.should.equal(false)
  })

  it('assigns tokens correctly to company when finalized', async function () {
    const newRate =  new BigNumber(350000000); // 350M APA tokens per 1 eth
    apaCrowdsale = await newCrowdsale(newRate)
    apaToken = AllPublicArtToken.at(await apaCrowdsale.token())

    await timer(dayInSecs * 42)

    await apaCrowdsale.buyTokens(buyer, {value, from: purchaser})

    await timer(endTime + 30)
    await apaCrowdsale.finalize()

    const companyAllocation = await apaCrowdsale.companyAllocation()
    const balance = await apaToken.balanceOf(companyAllocation)
    balance.should.be.bignumber.equal(expectedCompanyTokens)

    const buyerBalance = await apaToken.balanceOf(buyer)
    buyerBalance.should.be.bignumber.equal(350000000e+18)

    const totalSupply = await apaToken.totalSupply()
    totalSupply.should.be.bignumber.equal(expectedTokenSupply)
  })

  it('assigns remaining tokens to company if not all tokens are sold during crowdsale', async function () {
    const fictiousRate =  new BigNumber(300000000); // 350M APA tokens per 1 eth
    apaCrowdsale = await newCrowdsale(fictiousRate)
    apaToken = AllPublicArtToken.at(await apaCrowdsale.token())

    await timer(dayInSecs * 42)

    await apaCrowdsale.buyTokens(buyer, {value, from: purchaser})

    await timer(endTime + 30)
    await apaCrowdsale.finalize()

    const companyAllocation = await apaCrowdsale.companyAllocation()
    const balance = await apaToken.balanceOf(companyAllocation)
    balance.should.be.bignumber.equal(700000000e+18)

    const buyerBalance = await apaToken.balanceOf(buyer)
    buyerBalance.should.be.bignumber.equal(300000000e+18)

    const totalSupply = await apaToken.totalSupply()
    totalSupply.should.be.bignumber.equal(expectedTokenSupply)
  })

  describe('forward funds', () => {
      it('does not allow non-owners to set onePercent beneficiary', async () => {
          timer(20)

          try {
              await apaCrowdsale.setOnePercent(buyer, {from: buyer})
              assert.fail()
          } catch (e) {
              ensuresException(e)
          }
          const onePercent = await apaCrowdsale.onePercent.call()
          onePercent.should.be.equal('0x0000000000000000000000000000000000000000')
      })

      it('owner is able to set onePercent', async () => {
          timer(20)
          await apaCrowdsale.setOnePercent(beneficiary, {from: owner})
          const onePercent = await apaCrowdsale.onePercent.call()
          onePercent.should.be.equal(beneficiary)
      })

      it('onePercent beneficiary is not able to be set more than once', async () => {
          timer(20)
          await apaCrowdsale.setOnePercent(beneficiary, {from: owner})

          try {
              await apaCrowdsale.setOnePercent(buyer, {from: owner})
              assert.fail()
          } catch (e) {
              ensuresException(e)
          }

          const onePercent = await apaCrowdsale.onePercent.call()
          onePercent.should.be.equal(beneficiary)
      })

      it('takes 1 percent of the purchase funds and assigns it to one percent beneficiary', async () => {
          await timer(dayInSecs * 42)
          await apaCrowdsale.setOnePercent(beneficiary, {from: owner})
          const beneficiaryBalance = web3.eth.getBalance(beneficiary)

          await apaCrowdsale.buyTokens(buyer, {value, from: purchaser})

          const beneficiaryNewBalance = web3.eth.getBalance(beneficiary)
          const onePercentOfValue = value * 1 / 100
          const calculateUpdatedBalance = beneficiaryBalance.toNumber() + onePercentOfValue

          calculateUpdatedBalance.should.be.bignumber.equal(beneficiaryNewBalance)
          beneficiaryNewBalance.should.be.bignumber.above(beneficiaryBalance)
      })

      it('assigns 99 percent of the funds to wallet', async () => {
          await timer(dayInSecs * 42)
          const wallet = await apaCrowdsale.wallet()
          const walletBalance = web3.eth.getBalance(wallet)

          await apaCrowdsale.buyTokens(buyer, {value, from: purchaser})

          const walletNewBalance = web3.eth.getBalance(wallet)
          const ninetyNinePercentValue = value * 99 / 100
          const calculateUpdatedBalance = walletBalance.toNumber() + ninetyNinePercentValue

          calculateUpdatedBalance.should.be.bignumber.equal(walletNewBalance)
          walletNewBalance.should.be.bignumber.above(walletBalance)
      })
  })

  describe('token purchases plus their bonuses', () => {
      it('fails presale purchase with purchase of less than 10 ether', async () => {
          await timer(50) // within presale period
          try {
              await apaCrowdsale.buyTokens(buyer2, { value })
              assert.fail()
          } catch (e) {
              ensuresException(e)
          }

          const buyerBalance = await apaToken.balanceOf(buyer2)
          buyerBalance.should.be.bignumber.equal(0)
      })

      it('has bonus of 20% during the presale', async () => {
          await timer(50) // within presale period
          await apaCrowdsale.buyTokens(buyer2, { value: 10e+18 })

          const buyerBalance = await apaToken.balanceOf(buyer2)
          buyerBalance.should.be.bignumber.equal(600e+18) // 20% bonus
      })

      it('has bonus of 15% during first crowdsale bonus period', async () => {
          await timer(dayInSecs * 12)
          await apaCrowdsale.buyTokens(buyer2, { value })

          const buyerBalance = await apaToken.balanceOf(buyer2)
          buyerBalance.should.be.bignumber.equal(575e+17) // 15% bonus
      })

      it('is also able to buy tokens with bonus by sending ether to the contract directly', async () => {
          await timer(dayInSecs * 12)
          await apaCrowdsale.sendTransaction({ from: purchaser2, value })

          const purchaserBalance = await apaToken.balanceOf(purchaser2)
          purchaserBalance.should.be.bignumber.equal(575e+17) // 15% bonus
      })

      it('gives out 10% bonus during second crowdsale bonus period', async () => {
          await timer(dayInSecs * 22)
          await apaCrowdsale.buyTokens(buyer2, { value })

          const buyerBalance = await apaToken.balanceOf(buyer2)
          buyerBalance.should.be.bignumber.equal(55e+18) // 10% bonus
      })

      it('provides 5% bonus during third crowdsale bonus period', async () => {
          timer(dayInSecs * 32)
          await apaCrowdsale.buyTokens(buyer2, { value })

          const buyerBalance = await apaToken.balanceOf(buyer2)
          buyerBalance.should.be.bignumber.equal(525e+17) // 5% bonus
      })

      it('provides 0% bonus after third crowdsale bonus period', async () => {
          timer(dayInSecs * 42)
          await apaCrowdsale.buyTokens(buyer2, { value })

          const buyerBalance = await apaToken.balanceOf(buyer2)
          buyerBalance.should.be.bignumber.equal(50e+18) // 0% bonus
      })
  })

  describe('whitelisting', () => {
      it('should add address to whitelist', async () => {
          let whitelisted = await apaCrowdsale.isWhitelisted(sender)
          whitelisted.should.equal(false)

          await apaCrowdsale.addToWhitelist(sender, {from: owner})
          whitelisted = await apaCrowdsale.isWhitelisted(sender)
          whitelisted.should.equal(true)
      })

      it('should reject non-whitelisted sender', async () => {
          timer(20)

          try {
              await apaCrowdsale.buyTokens(beneficiary, {value, from: sender})
          } catch(error) {
              ensuresException(error)
          }
      })

      it('should sell to whitelisted address', async () => {
          await apaCrowdsale.addToWhitelist(sender, {from: owner})
          timer(dayInSecs * 42)
          await apaCrowdsale.buyTokens(beneficiary, {value, from: sender}).should.be.fulfilled
      })

      it('whitelists buyer rate with a preferential rate', async () => {
          await apaCrowdsale.addToWhitelist(buyer)
          await apaCrowdsale.setPreferantialRate(preferentialRate)

          const prefRate = await apaCrowdsale.preferentialRate()
          prefRate.should.be.bignumber.equal(preferentialRate)

          timer(dayInSecs * 42)

          await apaCrowdsale.buyTokens(buyer, { value })
          const balance = await apaToken.balanceOf.call(buyer)
          balance.should.be.bignumber.equal(100e+18)

          const raised = await apaCrowdsale.weiRaised();
          raised.should.be.bignumber.equal(value)
      })

      it('whitelists buyer rate with custom rate', async () => {
          await apaCrowdsale.addToWhitelist(buyer)
          await apaCrowdsale.setBuyerRate(buyer, 200e+18)

          timer(dayInSecs * 42)

          await apaCrowdsale.buyTokens(buyer, { value })
          const balance = await apaToken.balanceOf.call(buyer)
          balance.should.be.bignumber.equal(2e+38)

          const raised = await apaCrowdsale.weiRaised();
          raised.should.be.bignumber.equal(value)
      })
  })

  describe('companyAllocations', () => {
      beforeEach(async () =>{
          apaCrowdsale = await newCrowdsale(newRate)
          apaToken = AllPublicArtToken.at(await apaCrowdsale.token())

          timer(dayInSecs * 42)

          await apaCrowdsale.buyTokens(buyer, {value})

          await timer(dayInSecs * 70)
          await apaCrowdsale.finalize()
          await apaCrowdsale.unpauseToken()

          const companyAllocations = await apaCrowdsale.companyAllocation()
          companyAllocationsContract = CompanyAllocation.at(companyAllocations)
      })

      it('assigns tokens correctly CompanyAllocation contract', async function () {
          const balance = await apaToken.balanceOf(await companyAllocationsContract.address)
          balance.should.be.bignumber.equal(expectedCompanyTokens)
      })

      it('adds founder and their allocation', async function () {
          await companyAllocationsContract.addCompanyAllocation(founder1, 800)
          await companyAllocationsContract.addCompanyAllocation.sendTransaction(founder2, 1000, {from: owner})
          const allocatedTokens = await companyAllocationsContract.allocatedTokens()
          allocatedTokens.should.be.bignumber.equal(1800)

          const allocationsForFounder1 = await companyAllocationsContract.companyAllocations.call(founder1)
          const allocationsForFounder2 = await companyAllocationsContract.companyAllocations.call(founder2)
          allocationsForFounder1.should.be.bignumber.equal(800)
          allocationsForFounder2.should.be.bignumber.equal(1000)
      })

      it('does NOT unlock founders allocation before the unlock period is up', async function () {
          await companyAllocationsContract.addCompanyAllocation(founder1, 800)
          await companyAllocationsContract.addCompanyAllocation.sendTransaction(founder2, 1000, {from: owner})

          try {
              await companyAllocationsContract.unlock({from: founder1})
              assert.fail()
          } catch(e) {
              ensuresException(e)
          }

          const tokensCreated = await companyAllocationsContract.tokensCreated()
          tokensCreated.should.be.bignumber.equal(0)
      })

      it('unlocks founders allocation after the unlock period is up', async function () {
          let tokensCreated
          await companyAllocationsContract.addCompanyAllocation(founder1, 800)
          await companyAllocationsContract.addCompanyAllocation.sendTransaction(founder2, 1000, {from: owner})

          tokensCreated = await companyAllocationsContract.tokensCreated()
          tokensCreated.should.be.bignumber.equal(0)

          await timer(dayInSecs * 40)

          await companyAllocationsContract.unlock({from: founder1})
          await companyAllocationsContract.unlock({from: founder2})

          const tokenBalanceFounder1 = await apaToken.balanceOf(founder1)
          const tokenBalanceFounder2 = await apaToken.balanceOf(founder2)
          tokenBalanceFounder1.should.be.bignumber.equal(800)
          tokenBalanceFounder2.should.be.bignumber.equal(1000)
      })

      it('does NOT kill contract before one year is up', async function () {
          await companyAllocationsContract.addCompanyAllocation(founder1, 800)
          await companyAllocationsContract.addCompanyAllocation.sendTransaction(founder2, 1000, {from: owner})

          try {
              await companyAllocationsContract.kill()
              assert.fail()
          } catch(e) {
              ensuresException(e)
          }

          const balance = await apaToken.balanceOf(await companyAllocationsContract.address)
          balance.should.be.bignumber.equal(expectedCompanyTokens)

          const tokensCreated = await companyAllocationsContract.tokensCreated()
          tokensCreated.should.be.bignumber.equal(0)
      })

      it('is able to kill contract after one year', async () => {
          await companyAllocationsContract.addCompanyAllocation.sendTransaction(founder2, 1000, {from: owner})

          const tokensCreated = await companyAllocationsContract.tokensCreated()
          tokensCreated.should.be.bignumber.equal(0)

          await timer(dayInSecs * 400) // 400 days after

          await companyAllocationsContract.kill()

          const balance = await apaToken.balanceOf(await companyAllocationsContract.address)
          balance.should.be.bignumber.equal(0)

          const balanceOwner = await apaToken.balanceOf(owner)
          balanceOwner.should.be.bignumber.equal(expectedCompanyTokens)
      })
  })
});
